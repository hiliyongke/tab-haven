import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { TabRecord } from '@/core/tab-types';
import type { TemporarySection } from '@/core/site/Sections';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { GroupCard } from '@/ui/common/GroupCard';
import { Icon, Icons } from '@/ui/common/Icon';
import { TabRow } from '@/ui/tabs/TabRow';
import { VirtualRowList } from '@/ui/tabs/VirtualRowList';
import { DragType } from '@/ui/dnd/types';
import { groupAccentVar, useDomainAccent } from '@/ui/tabs/accent';
import { computeSplitGroupRoles } from '@/ui/tabs/splitGroupRoles';
import { useDataStore } from '@/stores/dataStore';
import { GroupEditDialog } from '@/ui/tabs/GroupEditDialog';
import type {
  RowListPassthrough,
  SectionCallbacks,
  SectionCardProps
} from '@/ui/tabs/sectionTypes';

/** 排序关闭时的虚拟化阈值（模块级常量：避免每次渲染重建，且便于统一调整）。 */
const VIRTUAL_THRESHOLD = 60;
/**
 * 排序开启时的强制虚拟化阈值。
 *
 * 定为 80 的依据是**可视行数与总行数的比例**（几何事实，不依赖性能实测）：
 * 虚拟列表高度上限 `min(480px, 50vh)`，cozy 档行高 28px —— 无论窗口多大，
 * 同时可见的只有 **10–17 行**。也就是说 80 行已经是可视区的 5–8 倍：
 * 用户要在 10 几行的窗口里对第 50 行以外做定位与拖拽，可视跨度与目标跨度
 * 严重不匹配，区内排序在这个量级上本就难以真正使用。
 * 与此同时全量渲染 80 行 = 80 个真实 DOM 行，虚拟化后仅约 29 行（可见 + overscan），
 * 差异 4 倍 —— 换流畅度是划算的。
 *
 * 代价（明确接受）：超过本值后区内排序**整体暂停** —— 不只是拖拽，
 * `Alt+↑↓` 键盘排序也一并停掉（见下方 `reorderEnabled={false}`），
 * 跨容器拖到固定空间仍可用。因此行内提示必须同时点明两者，
 * 否则键盘用户试按 Alt+↑↓ 无反应会以为功能坏了。
 *
 * 若要放宽：把本值调回 120 即可，需同步 `tests/ui/section-list-virtual.test.tsx`
 * 中「70 标签不虚拟化」用例的阈值。
 */
const FORCE_VIRTUAL_THRESHOLD = 80;

/** 虚拟列表高度：取视口的一半，夹在 [240, 480] 之间（注释见文件头的推导）。 */
const VIRTUAL_MIN_HEIGHT_PX = 240;
const VIRTUAL_MAX_HEIGHT_PX = 480;
const VIRTUAL_VIEWPORT_RATIO = 0.5;

/** 跟踪视口高度：虚拟列表高度随面板可用高度自适应，渲染期直读 window.innerHeight 不会在面板尺寸变化后更新。 */
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}

/**
 * 重复份数查询：键与 `DuplicateIndex.build` 同口径（webComparisonKey）。
 * 用原始 tab.url 查表会因归一化差异（导航中取 pendingUrl、主机小写、去默认端口）
 * 落空 —— 角标恒显示 1，重复标签不被提示，与「清理重复」入口的候选数矛盾。
 */
function duplicateCountOf(tab: TabRecord, counts: ReadonlyMap<string, number>): number {
  return counts.get(webComparisonKey(tab.url, tab.pendingUrl) ?? '') ?? 1;
}

function RowList({
  tabs,
  duplicateCounts,
  activeTabId,
  splitPartners,
  reorderEnabled,
  showUrl,
  rowActionsVisible,
  autoScrollActive,
  closeOnMiddleClick,
  density,
  showSplitBadges,
  depths,
  highlightedIds,
  searchActiveTabId,
  noCacheTabIds,
  callbacks,
  containerKey,
  sortableItems
}: {
  tabs: readonly TabRecord[];
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  splitPartners: ReadonlySet<number>;
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy' | 'large';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  depths?: ReadonlyMap<number, number>;
  highlightedIds?: ReadonlySet<number>;
  searchActiveTabId?: number;
  noCacheTabIds?: ReadonlySet<number>;
  callbacks: SectionCallbacks;
  /** 所属容器 key（section key），供全局拖拽判断同容器排序。 */
  containerKey: string;
  /**
   * 排序上下文的 id 全集，缺省取本块的 tab id。
   * **多子域分块渲染时必须传入整个分区的全集**：各块若只包含自己那部分，
   * 跨块拖拽时 over 的 id 不在对方 items 里，dnd-kit 无法排序，
   * 表现为「组内两个标签互相拖不动」。
   */
  sortableItems?: readonly (string | number)[];
}) {
  const { t } = useTranslation();
  // 分屏组竖线角色：同一 splitViewId 的「连续」标签段 → 组首/组中/组尾（单标签段也画线）。
  const splitGroupRoles = useMemo(() => computeSplitGroupRoles(tabs), [tabs]);
  // SortableContext items 必须 memo 化：每次渲染新建数组会让 dnd-kit context value 变化，
  // 子 sortable 节点多做一轮无效重渲染。
  const sortableItemIds = useMemo(
    () => (sortableItems ? [...sortableItems] : tabs.map((tab) => tab.id)),
    [sortableItems, tabs]
  );

  // 大列表虚拟滚动（零依赖窗口化），分两档是有意取舍：
  //  - 排序关闭时：超过 60 行即虚拟化（无排序负担，尽早省下 DOM）；
  //  - 排序开启时：放宽到 `FORCE_VIRTUAL_THRESHOLD` 行 —— SortableContext 要求
  //    全部项挂载，虚拟化与列表内排序天然互斥；排序是默认开启的高频能力，
  //    60 行就剥夺它会造成大面积行为突变，因此让「能拖拽排序」优先，
  //    直到行数大到必须让步。跨容器拖到固定空间仍可用。
  // 阈值只写在常量上，注释不重复具体数字：**注释里的数字会过期**。本段曾写
  // 「放宽到 120」而常量实为 80，两者不一致时读代码的人无从判断以哪个为准。
  const useVirtual =
    (!reorderEnabled && tabs.length > VIRTUAL_THRESHOLD) || tabs.length > FORCE_VIRTUAL_THRESHOLD;
  // 因超阈值被强制暂停排序时给出行内说明；用户主动关闭排序开关的虚拟化
  // 不提示——那是用户自己的选择，无行为突变。
  const sortPaused = reorderEnabled && tabs.length > FORCE_VIRTUAL_THRESHOLD;
  const viewportHeight = useViewportHeight();

  if (useVirtual) {
    // itemSize 为估算起步值：VirtualRowList 首行挂载后会实测校准，
    // 字号 / 密度 / 副标题开关调整不再要求同步改这里的公式。
    // 单行 = 行高 + 垂直 padding（compact 16+4 / cozy 16+12 / large 19+20）；
    // cozy 按 16+8 算得 24，实际 .density-cozy 是上下各 6px = 28，
    // 首帧 totalHeight 会少 4px，滚动条长度在挂载后跳一次。
    // showUrl 副标题 compact/cozy 取 +13（10px leading-tight），large 取 +16（12px）。
    const itemSize =
      (density === 'cozy' ? 28 : density === 'large' ? 39 : 20) +
      (showUrl ? (density === 'large' ? 16 : 13) : 0);
    // 虚拟列表高度随面板可用高度自适应（上限 50vh / 480px）：注释的既定目标是
    // 「避免列表里套列表」，但 720px 上限在 1000px 高的窗口下仍产出 660px 的独立
    // 滚动区 —— 它就是第三层。收紧到视口一半，让分区与外层主列表的比例稳定。
    const virtualMaxHeight = Math.max(
      VIRTUAL_MIN_HEIGHT_PX,
      Math.min(VIRTUAL_MAX_HEIGHT_PX, viewportHeight * VIRTUAL_VIEWPORT_RATIO)
    );
    return (
      <>
        {sortPaused && (
          /* role=status：本行是动态插入的，且它告知的是「Alt+↑↓ 排序被暂停」——
             恰好是键盘用户最依赖的能力，读屏必须播报而不是静默出现。
             文案必须同时点明拖拽与键盘：虚拟化后两者是一并停的（reorderEnabled=false），
             只说「不能拖拽」会让键盘用户误以为 Alt+↑↓ 仍可用。 */
          <p className="virtual-notice" role="status">
            {t('标签太多，本区暂时不能调整顺序（拖拽与 Alt+↑↓ 已暂停）')}
          </p>
        )}
        <VirtualRowList
          tabs={tabs}
          itemSize={itemSize}
          maxHeight={virtualMaxHeight}
          activeTabId={activeTabId}
          autoScrollActive={autoScrollActive}
          searchActiveTabId={searchActiveTabId}
          renderRow={(tab) => (
            <TabRow
              tab={tab}
              duplicateCount={duplicateCountOf(tab, duplicateCounts)}
              isActive={tab.id === activeTabId}
              isSplitCompanion={splitPartners.has(tab.id)}
              splitGroupRole={splitGroupRoles.get(tab.id)}
              /* 虚拟化分区不参与列表内排序（Alt+↑↓ 与拖拽重排一并暂停）；
                 跨容器拖到固定空间仍可用（由全局 DndContext 承接）。 */
              reorderEnabled={false}
              showUrl={showUrl}
              rowActionsVisible={rowActionsVisible}
              /* 虚拟化分支的激活行滚动由 VirtualRowList 按 index 单点承担；
                 行级 scrollIntoView 必须关闭，否则激活行落在 overscan 缓冲区
                 （已挂载但不可见）时两路 smooth 滚动并发、目标口径不同而抖动。 */
              autoScrollActive={false}
              closeOnMiddleClick={closeOnMiddleClick}
              density={density}
              showSplitBadges={showSplitBadges}
              indent={depths?.get(tab.id)}
              isHighlighted={highlightedIds?.has(tab.id)}
              isSearchActive={tab.id === searchActiveTabId}
              noCache={noCacheTabIds?.has(tab.id)}
              onActivate={callbacks.onActivate}
              onToggleMute={callbacks.onToggleMute}
              onTogglePin={callbacks.onTogglePin}
              onClose={callbacks.onCloseTab}
              onDuplicate={callbacks.onDuplicate}
              onDiscard={callbacks.onDiscard}
              onMoveTab={callbacks.onMoveTab}
              containerKey={containerKey}
            />
          )}
        />
      </>
    );
  }

  return (
    <SortableContext items={sortableItemIds} strategy={verticalListSortingStrategy}>
      <ul>
        {tabs.map((tab) => (
          <TabRow
            key={tab.id}
            tab={tab}
            duplicateCount={duplicateCountOf(tab, duplicateCounts)}
            isActive={tab.id === activeTabId}
            isSplitCompanion={splitPartners.has(tab.id)}
            splitGroupRole={splitGroupRoles.get(tab.id)}
            reorderEnabled={reorderEnabled}
            showUrl={showUrl}
            rowActionsVisible={rowActionsVisible}
            autoScrollActive={autoScrollActive}
            closeOnMiddleClick={closeOnMiddleClick}
            density={density}
            showSplitBadges={showSplitBadges}
            indent={depths?.get(tab.id)}
            isHighlighted={highlightedIds?.has(tab.id)}
            isSearchActive={tab.id === searchActiveTabId}
            noCache={noCacheTabIds?.has(tab.id)}
            onActivate={callbacks.onActivate}
            onToggleMute={callbacks.onToggleMute}
            onTogglePin={callbacks.onTogglePin}
            onClose={callbacks.onCloseTab}
            onDuplicate={callbacks.onDuplicate}
            onDiscard={callbacks.onDiscard}
            onMoveTab={callbacks.onMoveTab}
            containerKey={containerKey}
          />
        ))}
      </ul>
    </SortableContext>
  );
}

/** 统一的行列表渲染（RowList 的输入 props 在此一次性透传）。 */
function SectionRows({
  tabs,
  depths,
  containerKey,
  sortableItems,
  ...rest
}: {
  tabs: readonly TabRecord[];
  depths?: ReadonlyMap<number, number>;
  containerKey: string;
  /** 排序上下文的 id 全集；多子域分块时由调用方传入整个分区的全集（见 RowList）。 */
  sortableItems?: readonly (string | number)[];
} & RowListPassthrough) {
  return (
    <RowList
      tabs={tabs}
      depths={depths}
      containerKey={containerKey}
      sortableItems={sortableItems}
      {...rest}
    />
  );
}

/** 拖拽数据：原生组与虚拟分区（站点组 / 语言组）都参与排序；置顶/未分组禁用 sortable。 */
function sectionDragDataFor(section: TemporarySection) {
  return {
    type: DragType.Section,
    sectionKey: section.key,
    groupId: section.kind === 'native' ? section.groupId : undefined,
    title: section.title,
    tabIds: section.tabs.map((tab) => tab.id)
  } as const;
}

const isSortableDisabled = (section: TemporarySection): boolean =>
  section.kind === 'pinned' || section.kind === 'ungrouped';

/** 分组强调色推导：原生组用 Chrome 组色、站点组用域名哈希色 / favicon 主色（mono 模式统一中性）。 */
function useSectionAccent(section: TemporarySection): string | undefined {
  const mono = useDataStore((state) => state.settings.groupAccentStyle === 'mono');
  const firstFavicon =
    section.kind === 'site' ? section.tabs.find((tab) => tab.favIconUrl)?.favIconUrl : undefined;
  const siteDomain = section.kind === 'site' ? section.siteKey : undefined;
  const siteAccent = useDomainAccent(firstFavicon, siteDomain);
  if (section.kind === 'native') return groupAccentVar(section.color);
  if (section.kind === 'site') return mono ? undefined : siteAccent;
  return undefined;
}

/** 折叠时显示的播放提示（点击展开分组并定位到播放标签）。 */
function PlayingIndicator({
  playingTab,
  isCollapsed,
  section,
  callbacks,
  onPlay
}: {
  playingTab: TabRecord;
  isCollapsed: boolean;
  section: Extract<TemporarySection, { kind: 'native' | 'site' }>;
  callbacks: SectionCallbacks;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="section-media-indicator"
      title={t('定位到播放中的标签')}
      aria-label={t('定位到播放中的标签')}
      onClick={(event) => {
        event.stopPropagation();
        onPlay();
        if (isCollapsed) {
          if (section.kind === 'native') {
            callbacks.onToggleGroupCollapsed(section.groupId, false);
          } else {
            callbacks.onToggleSiteCollapsed(section.siteKey, false);
          }
        }
        callbacks.onActivate(playingTab.id);
      }}
    >
      <Icon d={Icons.volumeOn} className="h-3 w-3" />
      <span className="section-media-label">{t('播放中')}</span>
      <span className="section-media-dot" aria-hidden="true" />
    </button>
  );
}

/** 未分组：普通标签整行列表。 */
const UngroupedSectionCard = memo(function UngroupedSectionCard({
  section,
  ...rowProps
}: Omit<SectionCardProps, 'section'> & {
  section: Extract<TemporarySection, { kind: 'ungrouped' }>;
}) {
  const accent = useSectionAccent(section);
  return (
    <GroupCard
      id={section.key}
      dragData={sectionDragDataFor(section)}
      disabled={isSortableDisabled(section)}
      title={section.title}
      count={section.tabs.length}
      accent={accent}
    >
      <div className="section-body">
        <SectionRows
          tabs={section.tabs}
          depths={section.depths}
          containerKey={section.key}
          {...rowProps}
        />
      </div>
    </GroupCard>
  );
});

/** 可折叠分组卡（原生组 / 站点组）：折叠、播放提示、子域分块、原生组编辑弹窗。 */
const CollapsibleSectionCard = memo(function CollapsibleSectionCard({
  section,
  collapsedGroups,
  collapsedSites,
  ...rowProps
}: Omit<SectionCardProps, 'section'> & {
  section: Extract<TemporarySection, { kind: 'native' | 'site' }>;
}) {
  const { t } = useTranslation();
  const isCollapsed =
    section.kind === 'native'
      ? collapsedGroups.has(section.groupId)
      : collapsedSites.has(section.siteKey);
  const count = section.tabs.length;

  // 原生组编辑对话框状态（改名 / 换色 / 删除），统一走 DialogShell 保证焦点与键盘行为。
  const [editOpen, setEditOpen] = useState(false);
  /**
   * 从折叠分组的播放提示进入后，临时只展示播放中的标签。
   *
   * 「是否生效」是渲染期直接算出来的（下面 `visibleTabs` 里的 `!isCollapsed`），
   * 不再用 effect 把 `isCollapsed` 的变化回写进 state —— 那是一次「渲染 → 副作用
   * → 再渲染」的额外往返，且让 `playingOnly` 与 `isCollapsed` 成了两份需要人肉
   * 保持同步的状态。
   */
  const [playingOnly, setPlayingOnly] = useState(false);

  const accent = useSectionAccent(section);
  const chevron = (
    <Icon
      d={Icons.chevron}
      className={'h-3.5 w-3.5 transition-transform' + (isCollapsed ? '' : ' rotate-90')}
    />
  );

  const playingTab = section.tabs.find((tab) => tab.audible && !tab.muted);
  // 折叠态不渲染 body，故「播放中筛选」只在展开时成立；展开即生效，无需回写 state。
  const visibleTabs = playingOnly && !isCollapsed && playingTab ? [playingTab] : section.tabs;
  // 播放提示只在折叠时显示；展开后通过单独的标签行状态识别，避免标题区重复提示。
  const mediaIndicator =
    isCollapsed && playingTab ? (
      <PlayingIndicator
        playingTab={playingTab}
        isCollapsed={isCollapsed}
        section={section}
        callbacks={rowProps.callbacks}
        onPlay={() => setPlayingOnly(true)}
      />
    ) : undefined;

  // 原生组头部操作：存为固定文件夹 + 编辑（拖拽事件由 dnd-kit 在 head 接管，无需独立手柄按钮）。
  const headerAction =
    section.kind === 'native' ? (
      <>
        {rowProps.callbacks.onSaveGroupAsFolder && (
          <button
            type="button"
            className="row-action"
            title={t('存为文件夹')}
            aria-label={t('存为文件夹')}
            onClick={(event) => {
              event.stopPropagation();
              rowProps.callbacks.onSaveGroupAsFolder?.(section.groupId);
            }}
          >
            <Icon d={Icons.folderPlus} className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="row-action"
          title={t('编辑标签组')}
          aria-label={t('编辑标签组')}
          onClick={(event) => {
            event.stopPropagation();
            setEditOpen(true);
          }}
        >
          <Icon d={Icons.pencil} className="h-3.5 w-3.5" />
        </button>
      </>
    ) : undefined;

  const onToggle = () => {
    setPlayingOnly(false);
    if (section.kind === 'native') {
      rowProps.callbacks.onToggleGroupCollapsed(section.groupId, !isCollapsed);
    } else {
      rowProps.callbacks.onToggleSiteCollapsed(section.siteKey, !isCollapsed);
    }
  };
  // 展开态：站点分区永远平铺渲染（子域折叠模式已移除，层级只有一级）。
  const renderBody = () => (
    <div className="section-body">
      <SectionRows
        tabs={visibleTabs}
        depths={section.depths}
        containerKey={section.key}
        {...rowProps}
      />
    </div>
  );

  return (
    <>
      <GroupCard
        id={section.key}
        dragData={sectionDragDataFor(section)}
        disabled={isSortableDisabled(section)}
        title={section.title}
        count={count}
        accent={accent}
        icon={chevron}
        onToggle={onToggle}
        mediaIndicator={mediaIndicator}
        action={headerAction}
        // 「×」= 整批关闭该分组的全部标签（一次撤销批次，可一键找回）。
        // 开了「自动分组同步为原生组」的用户，域名分组实际是 native 组
        // （标题即域名）——只挂 site 会让这批用户完全找不到入口。
        // 关闭组内全部标签后空组由浏览器回收，不额外解散浏览器分组结构。
        onClose={
          rowProps.callbacks.onCloseSection
            ? () => rowProps.callbacks.onCloseSection?.(section)
            : undefined
        }
        // 影响面写进 title/aria-label：整批关闭是分区头唯一的破坏性操作，
        // 只写「关闭该域名的全部标签」而无数量时，误点等于一次关掉整个分组。
        // 让用户在点之前就知道会关掉几个（可撤销，故只需数量预览不需二次确认）。
        closeTitle={t(
          section.kind === 'site'
            ? '关闭该域名的全部 {{count}} 个标签（可撤销）'
            : '关闭该分组的全部 {{count}} 个标签（可撤销）',
          { count }
        )}
        collapsed={isCollapsed}
      >
        {isCollapsed ? null : renderBody()}
      </GroupCard>
      {/* 弹窗必须脱离 GroupCard 的折叠闸门（{!collapsed && children}）：
          不脱离则折叠时点「编辑」无任何反应（弹窗不挂载），展开后弹窗还会
          「僵尸弹出」——状态在闸门外、渲染在闸门内所致（FolderRow 同型坑）。
          弹窗经 DialogShell portal 到 body，DOM 位置不影响显示。 */}
      {section.kind === 'native' && editOpen && (
        <GroupEditDialog
          title={section.title}
          color={section.color}
          onRename={(name) => rowProps.callbacks.onGroupRename(section.groupId, name)}
          onRecolor={(color) => rowProps.callbacks.onGroupRecolor(section.groupId, color)}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
});

/**
 * 单个分组卡片：按类型分发到未分组 / 可折叠（原生组 + 站点组）子组件。
 * 强调色推导由 useSectionAccent 统一处理。
 * 浏览器置顶（pinned）由 App 层 CategoryModule 单独渲染，不会进入本列表。
 *
 * 连同两个子卡一起 memo：只有分组卡稳定，叶子 TabRow / RowItem 的 memo 浅比较才有收益。
 */
const SectionCard = memo(function SectionCard(props: SectionCardProps) {
  const { section } = props;
  if (section.kind === 'pinned') return null;
  if (section.kind === 'ungrouped') return <UngroupedSectionCard {...props} section={section} />;
  // 走到这里 section 已收窄为 native | site
  return <CollapsibleSectionCard {...props} section={section} />;
});

export { SectionCard };
