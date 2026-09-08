import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { TabRecord } from '@/core/tab-types';
import type { SiteSubGroup, TemporarySection } from '@/core/site/Sections';
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
/** 排序开启时的强制虚拟化阈值（见 RowList 内说明）。 */
const FORCE_VIRTUAL_THRESHOLD = 120;

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
  density?: 'compact' | 'cozy';
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

  // 大列表虚拟滚动（零依赖窗口化），分两档是有意取舍：
  //  - 排序关闭时：超过 60 行即虚拟化（无排序负担，尽早省下 DOM）；
  //  - 排序开启时：单独放宽到 120 行（原为 200）—— SortableContext 要求全部项挂载，
  //    虚拟化与列表内排序天然互斥；排序是默认开启的高频能力，60 行就剥夺它会
  //    造成大面积行为突变，因此让「能拖拽排序」优先，直到行数大到必须让步。
  //    注意这是**下调**：120~200 行的分区从此不再支持列表内拖拽排序（>120 时
  //    排序暂停并给出行内说明），换来的是大列表不再全量挂载。跨容器拖到固定空间仍可用。
  const useVirtual =
    (!reorderEnabled && tabs.length > VIRTUAL_THRESHOLD) || tabs.length > FORCE_VIRTUAL_THRESHOLD;
  // 因超阈值被强制暂停排序时给出行内说明；用户主动关闭排序开关的虚拟化
  // 不提示——那是用户自己的选择，无行为突变。
  const sortPaused = reorderEnabled && tabs.length > FORCE_VIRTUAL_THRESHOLD;

  if (useVirtual) {
    // itemSize 为估算起步值：VirtualRowList 首行挂载后会实测校准，
    // 字号 / 密度 / 副标题开关调整不再要求同步改这里的公式。
    // 单行 = text-xs 行高 16px + 垂直 padding（compact 4px / cozy 8px）→ 20 / 24；
    // showUrl 副标题（10px leading-tight ≈ 12.5px）取整 +13 → 33 / 37。
    const itemSize = (density === 'cozy' ? 24 : 20) + (showUrl ? 13 : 0);
    return (
      <>
        {sortPaused && <p className="virtual-notice">{t('tabs.largeListNotice')}</p>}
        <VirtualRowList
          tabs={tabs}
          itemSize={itemSize}
          maxHeight={480}
          activeTabId={activeTabId}
          autoScrollActive={autoScrollActive}
          renderRow={(tab) => (
            <TabRow
              tab={tab}
              duplicateCount={duplicateCounts.get(tab.url || '') ?? 1}
              isActive={tab.id === activeTabId}
              isSplitCompanion={splitPartners.has(tab.id)}
              splitGroupRole={splitGroupRoles.get(tab.id)}
              /* 虚拟化分区不参与列表内排序（Alt+↑↓ 与拖拽重排一并暂停）；
                 跨容器拖到固定空间仍可用（由全局 DndContext 承接）。 */
              reorderEnabled={false}
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
          )}
        />
      </>
    );
  }

  return (
    <SortableContext
      items={sortableItems ? [...sortableItems] : tabs.map((tab) => tab.id)}
      strategy={verticalListSortingStrategy}
    >
      <ul>
        {tabs.map((tab) => (
          <TabRow
            key={tab.id}
            tab={tab}
            duplicateCount={duplicateCounts.get(tab.url || '') ?? 1}
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
      title={t('status.jumpToPlaying')}
      aria-label={t('status.jumpToPlaying')}
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
      <Icon d={Icons.mute} className="h-3 w-3" />
      <span className="section-media-label">{t('status.playing')}</span>
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
  // 从折叠分组的播放提示进入后，临时只展示播放中的标签。
  const [playingOnly, setPlayingOnly] = useState(false);
  useEffect(() => {
    if (isCollapsed) setPlayingOnly(false);
  }, [isCollapsed]);

  const accent = useSectionAccent(section);
  const chevron = (
    <Icon
      d={Icons.chevron}
      className={'h-3.5 w-3.5 transition-transform' + (isCollapsed ? '' : ' rotate-90')}
    />
  );

  const playingTab = section.tabs.find((tab) => tab.audible && !tab.muted);
  const visibleTabs = playingOnly && playingTab ? [playingTab] : section.tabs;
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
            title={t('fixed.saveGroupAsFolder')}
            aria-label={t('fixed.saveGroupAsFolder')}
            onClick={(event) => {
              event.stopPropagation();
              rowProps.callbacks.onSaveGroupAsFolder?.(section.groupId);
            }}
          >
            <Icon d={Icons.saveToFolder} className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="row-action"
          title={t('groups.edit')}
          aria-label={t('groups.edit')}
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
  // 展开态：site 多子域时按子域再分块（折叠子标题）；媒体定位模式只保留播放标签所在子域。
  const subGroups: SiteSubGroup[] =
    section.kind === 'site'
      ? section.subgroups
          .map((sub) => ({
            ...sub,
            tabs: playingOnly ? sub.tabs.filter((tab) => tab.id === playingTab?.id) : sub.tabs
          }))
          .filter((sub) => sub.tabs.length > 0)
      : [];

  // 多子域分块时各块共享整个分区的排序全集（见 RowList.sortableItems）：
  // 否则跨块拖拽的 over 不在对方 items 里，dnd-kit 无法排序。
  const subGroupTabIds = subGroups.flatMap((sub) => sub.tabs.map((tab) => tab.id));

  const renderBody = () => (
    <>
      {section.kind === 'native' && editOpen && (
        <GroupEditDialog
          title={section.title}
          color={section.color}
          onRename={(name) => rowProps.callbacks.onGroupRename(section.groupId, name)}
          onRecolor={(color) => rowProps.callbacks.onGroupRecolor(section.groupId, color)}
          onClose={() => setEditOpen(false)}
        />
      )}
      <div className="section-body">
        {subGroups.length > 0 ? (
          <div className="flex flex-col gap-1">
            {subGroups.map((sub) => (
              <div key={sub.subdomain || 'root'}>
                <div className="px-1.5 py-0 text-3xs leading-tight text-gray-600">{sub.label}</div>
                <SectionRows
                  tabs={sub.tabs}
                  containerKey={section.key}
                  sortableItems={subGroupTabIds}
                  {...rowProps}
                />
              </div>
            ))}
          </div>
        ) : (
          <SectionRows
            tabs={visibleTabs}
            depths={section.depths}
            containerKey={section.key}
            {...rowProps}
          />
        )}
      </div>
    </>
  );

  return (
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
      collapsed={isCollapsed}
    >
      {isCollapsed ? null : renderBody()}
    </GroupCard>
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
