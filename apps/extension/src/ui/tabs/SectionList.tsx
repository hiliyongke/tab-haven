import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Density } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import type { TemporarySection } from '@/core/site/Sections';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { EmptyTabs } from '@/ui/common/ListStates';
import { SectionCard } from '@/ui/tabs/sectionCards';
import type { SectionCallbacks } from '@/ui/tabs/sectionTypes';

/** 用户主动定位当前标签时，请求临时区展开其所属分组。 */
export const LOCATE_SECTION_EVENT = 'tabs:locate-section';

/**
 * 临时区 section 列表：固定区（置顶）→ 原生组 → 网站组（含子域折叠）→ 未分组。
 * 每个 section 渲染为独立卡片（.section-card），标题/计数清晰，分组辨识度更高。
 * 折叠状态由调用方（本地态）持有并通过 props 回传。
 *
 * 卡片与行渲染的实现见 `sectionCards.tsx`，共享契约类型见 `sectionTypes.ts`。
 */

export const SectionList = memo(SectionListImpl);

function SectionListImpl({
  sections,
  collapsedGroups,
  collapsedSites,
  duplicateCounts,
  activeTabId,
  splitPartners,
  reorderEnabled,
  showUrl,
  autoScrollActive,
  closeOnMiddleClick,
  density,
  rowActionsVisible,
  showSplitBadges,
  highlightedIds,
  searchActiveTabId,
  noCacheTabIds,
  groupMode = 'site',
  callbacks
}: {
  sections: readonly TemporarySection[];
  collapsedGroups: ReadonlySet<number>;
  collapsedSites: ReadonlySet<string> | readonly string[];
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
  highlightedIds?: ReadonlySet<number>;
  searchActiveTabId?: number;
  noCacheTabIds?: ReadonlySet<number>;
  /** 临时区聚合方式：分区标题必须与实际聚合维度一致（按域名时叫「站点分组」）。 */
  groupMode?: 'site' | 'opener' | 'language';
  callbacks: SectionCallbacks;
}) {
  const { t } = useTranslation();
  const collapsedSitesSet = useMemo(
    () => (collapsedSites instanceof Set ? collapsedSites : new Set(collapsedSites)),
    [collapsedSites]
  );
  // 分区标题随聚合方式变化：按语言聚合时里面是语言组，写死「域名分组」会名不符实。
  const groupsTitle =
    groupMode === 'language'
      ? t('语言分组')
      : groupMode === 'opener'
        ? t('来源树分组')
        : t('站点分组');

  // 定位事件处理器读取的是「触发那一刻」的最新值，但这些值（sections 等）
  // 每次过滤都会变。若直接进依赖数组，每次搜索输入都会解绑/重绑 window 监听。
  // 改用 ref 持有最新值 + 空依赖，只挂载一次（与 Dialog 的 useModalA11y 同构）。
  const locateContextRef = useRef({ sections, collapsedGroups, collapsedSitesSet, callbacks });
  // 在 effect 里更新而非渲染期赋值：React 19 并发渲染下组件可能渲染但不提交，
  // 渲染期写 ref 会把「未提交的中间值」泄漏给后续读取方。effect 在提交后执行，
  // 且早于任何用户交互，语义与之前等价。
  useEffect(() => {
    locateContextRef.current = { sections, collapsedGroups, collapsedSitesSet, callbacks };
  }, [sections, collapsedGroups, collapsedSitesSet, callbacks]);

  useEffect(() => {
    const handleLocateSection = (event: Event) => {
      const tabId = (event as CustomEvent<number>).detail;
      if (!Number.isInteger(tabId)) return;
      const {
        sections: secs,
        collapsedGroups: groups,
        collapsedSitesSet: sites,
        callbacks: cb
      } = locateContextRef.current;
      const section = secs.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId));
      if (!section) return;
      if (section.kind === 'native' && groups.has(section.groupId)) {
        cb.onToggleGroupCollapsed(section.groupId, false);
      } else if (section.kind === 'site' && sites.has(section.siteKey)) {
        cb.onToggleSiteCollapsed(section.siteKey, false);
      }
    };
    window.addEventListener(LOCATE_SECTION_EVENT, handleLocateSection);
    return () => window.removeEventListener(LOCATE_SECTION_EVENT, handleLocateSection);
  }, []);

  // 分区头排序（dnd-kit）：原生组与虚拟分区（站点组 / 语言组）都可拖动排序，
  // 排序逻辑由全局 DndContext 的 onDragEnd 处理。
  // 置顶区独立渲染、未分组区是兜底容器，两者不参与分区排序。
  // items 必须 memo：SortableContext 以 items 引用计算 context value，
  // 每次渲染新建数组会击穿下游所有 useSortable 分组头的 memo（同 FolderRow 约定）。
  const sortableSectionKeys = useMemo(
    () => sections.filter((s) => s.kind === 'native' || s.kind === 'site').map((s) => s.key),
    [sections]
  );

  const nativeSiteSections = sections.filter((s) => s.kind === 'native' || s.kind === 'site');
  const ungroupedSection = sections.find((s) => s.kind === 'ungrouped');

  const renderSectionCard = (section: TemporarySection) => (
    <SectionCard
      key={section.key}
      section={section}
      collapsedGroups={collapsedGroups}
      collapsedSites={collapsedSitesSet}
      duplicateCounts={duplicateCounts}
      activeTabId={activeTabId}
      splitPartners={splitPartners}
      reorderEnabled={reorderEnabled}
      showUrl={showUrl}
      rowActionsVisible={rowActionsVisible}
      autoScrollActive={autoScrollActive}
      closeOnMiddleClick={closeOnMiddleClick}
      density={density}
      showSplitBadges={showSplitBadges}
      highlightedIds={highlightedIds}
      searchActiveTabId={searchActiveTabId}
      noCacheTabIds={noCacheTabIds}
      callbacks={callbacks}
    />
  );

  return (
    <SortableContext items={sortableSectionKeys} strategy={verticalListSortingStrategy}>
      {/* 间距统一交给 .section-card / .module-shell 的 margin+border+padding：
          此处再叠一层 gap-1 会让「模块外壳 → 首个分区」变成 4+1=5px，
          而模块内部相邻分区是 4px —— 同一列两种间距。 */}
      <div className="flex flex-col" data-density={density}>
        {sections.length === 0 ? (
          /* 复用 EmptyTabs 而非在这里另写一份：同一条件两份空态，文案要改两处，
             且这份没有 action（死路空态）—— 用户看到「还没有标签」却无处可去。 */
          <EmptyTabs />
        ) : (
          <>
            {nativeSiteSections.length > 0 && (
              <CategoryModule
                title={groupsTitle}
                count={nativeSiteSections.length}
                /* 模块级计数是「分组数」不是标签数：读屏播报必须与标题口径一致，
                   否则「站点分组 5」会被读成「共 5 个标签」。 */
                countLabel={t('共 {{count}} 个分组', { count: nativeSiteSections.length })}
                className="module-shell groups-module"
              >
                {nativeSiteSections.map(renderSectionCard)}
              </CategoryModule>
            )}
            {ungroupedSection && renderSectionCard(ungroupedSection)}
          </>
        )}
      </div>
    </SortableContext>
  );
}

/** 供父组件计算拆分伙伴集合：与当前激活标签同 splitViewId 的其它标签。 */
export function splitPartnerIds(
  tabs: readonly TabRecord[],
  activeTabId: number | undefined
): Set<number> {
  const active = tabs.find((tab) => tab.id === activeTabId);
  const activeSplit = active?.splitViewId;
  if (activeSplit === undefined) return new Set();
  return new Set(
    tabs
      .filter((tab) => tab.id !== activeTabId && tab.splitViewId === activeSplit)
      .map((tab) => tab.id)
  );
}
