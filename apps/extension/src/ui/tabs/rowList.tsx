import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Density } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { TabRow } from '@/ui/tabs/TabRow';
import { VirtualRowList } from '@/ui/tabs/VirtualRowList';
import { computeSplitGroupRoles } from '@/ui/tabs/splitGroupRoles';
import type { RowListPassthrough, SectionCallbacks } from '@/ui/tabs/sectionTypes';

/** 排序关闭时的虚拟化阈值（模块级常量：避免每次渲染重建，且便于统一调整）。 */
const VIRTUAL_THRESHOLD = 60;
/**
 * 排序开启时的强制虚拟化阈值。
 *
 * 定为 80 的依据是**可视行数与总行数的比例**（几何事实，不依赖性能实测）：
 * 虚拟列表高度上限 `min(480px, 50vh)`，cozy 档行高 28px —— 无论窗口多大，
 * 同时可见的只有 **10–17 行**，80 行已是可视区的 5–8 倍：
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

/**
 * 分区内的行列表：虚拟化分支与全量分支的唯一入口。
 *
 * 从 `sectionCards` 拆出的原因：这段是「渲染策略」（阈值判定 + 虚拟化参数），
 * 与分区卡片的折叠/编辑/强调色逻辑互不复用，却占原文件三分之一。
 */
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
  density?: Density;
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
  // 阈值以常量为唯一事实来源，注释只说明行为，避免重复数字造成口径漂移。
  const useVirtual =
    (!reorderEnabled && tabs.length > VIRTUAL_THRESHOLD) || tabs.length > FORCE_VIRTUAL_THRESHOLD;
  // 因超阈值被强制暂停排序时给出行内说明；用户主动关闭排序开关的虚拟化
  // 不提示——那是用户自己的选择，无行为突变。
  const sortPaused = reorderEnabled && tabs.length > FORCE_VIRTUAL_THRESHOLD;
  const viewportHeight = useViewportHeight();

  if (useVirtual) {
    // itemSize 作为首帧估算值；VirtualRowList 挂载后实测行高，并在字号、密度或副标题变化时重新校准。
    // 单行 = 行高 + 垂直 padding（tight 16+0 / compact 16+4 / cozy 16+12 / large 19+20）；
    // cozy 按 16+8 算得 24，实际 .density-cozy 是上下各 6px = 28，
    // 首帧 totalHeight 会少 4px，滚动条长度在挂载后跳一次。
    // tight 必须与 compact 取不同的值：VirtualRowList 以 itemSize 变化作为
    // 「丢弃旧实测值重新校准」的信号，两者同为 20 时切档不会重测，
    // 虚拟列表会沿用旧行高（表现为行重叠或大段空隙）。
    // showUrl 副标题 compact/cozy 取 +13（10px leading-tight），large 取 +16（12px）。
    const itemSize =
      (density === 'tight' ? 16 : density === 'cozy' ? 28 : density === 'large' ? 39 : 20) +
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
              /* 同理：搜索命中行的滚动也由 VirtualRowList 按 index 承担
                 （命中行可能尚未挂载）。isSearchActive 只留作高亮样式。 */
              autoScrollOnSearch={false}
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
export function SectionRows({
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
