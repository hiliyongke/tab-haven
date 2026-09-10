import { useCallback, useMemo } from 'react';
import { deriveSections } from '@/core/site/Sections';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';

/**
 * 分区派生与折叠态展示。
 *
 * 从 `App.tsx` 抽出（原先 baseSections / allSections / pinned / rest / 折叠集合 /
 * 全部折叠判定 / 一键折叠散布在约 100 行里）。这里有三个**性能敏感**且注释已明确
 * 记录过的约定，集中后才不至于在下次改动中被无意破坏：
 *
 * 1. `deriveSections` 是全量计算（排序 + 站点聚合 + opener 树），非过滤态下
 *    「自动分组 effect」与「展示用 allSections」入参完全相同 —— 必须只算一次共用；
 * 2. `pinnedSection` / `restSections` / `pinnedSortableIds` 必须保持引用稳定：
 *    `SectionList` 是 memo 组件，dnd-kit 的 `SortableContext value` 也吃引用，
 *    每次渲染新建数组会让整棵列表树无效重渲染；
 * 3. 空折叠集合必须是**模块级常量**：它是 `SectionList` props 的依赖项，
 *    每次渲染新建 `Set` / 数组会击穿浅比较（过滤态下每键击都重算整条派生链）。
 */

/** 搜索态下「展示用」折叠集合的空集单例（见文件头约定 3）。 */
const EMPTY_COLLAPSED_GROUPS: ReadonlySet<number> = new Set();
const EMPTY_COLLAPSED_SITES: readonly string[] = [];

export interface SectionDerivationOptions {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  /** 过滤后的标签集（仅过滤态使用；过滤态下用它与基线区分）。 */
  filteredTabs: readonly TabRecord[];
  isFiltering: boolean;
  excludedTabIds: ReadonlySet<number>;
  sortMode: 'browser' | 'recency';
  groupMode: 'site' | 'opener' | 'language';
  aggregationThreshold: number;
  /** 翻译函数：切换语言时引用变化 → 分区标题重算。 */
  t: (key: string, options?: Record<string, unknown>) => string;
  collapsedSites: readonly string[];
  setGroupCollapsed: (groupId: number, collapsed: boolean) => Promise<void> | void;
  toggleSiteCollapsed: (siteKey: string, collapsed: boolean) => Promise<void> | void;
}

export function useSectionDerivation(options: SectionDerivationOptions) {
  const {
    tabs,
    groups,
    filteredTabs,
    isFiltering,
    excludedTabIds,
    sortMode,
    groupMode,
    aggregationThreshold,
    t,
    collapsedSites,
    setGroupCollapsed,
    toggleSiteCollapsed
  } = options;

  /**
   * 未过滤态的分区基线。
   *
   * deriveSections 接收 translate（来自 useTranslation 的 t）：切换语言时 t 重新生成，
   * 分区标题随之重算。t 本身即为 memo 键（i18n.language 变化 → t 引用变化），
   * 无需再额外读 i18n.language —— 两者等价，保留一份避免双重触发。
   */
  const baseSections = useMemo(
    () =>
      deriveSections({
        tabs: tabs as TabRecord[],
        groups: groups as TabGroupRecord[],
        excludedTabIds,
        sortMode,
        groupMode,
        threshold: aggregationThreshold,
        translate: t
      }),
    [tabs, groups, excludedTabIds, sortMode, groupMode, aggregationThreshold, t]
  );

  const allSections = useMemo(() => {
    // 非过滤态下 filteredTabs 与 tabs 等价，直接复用基线结果。
    if (!isFiltering) return baseSections;
    return deriveSections({
      tabs: filteredTabs as TabRecord[],
      groups: groups as TabGroupRecord[],
      excludedTabIds,
      sortMode,
      groupMode,
      threshold: aggregationThreshold,
      translate: t
    });
  }, [
    isFiltering,
    baseSections,
    filteredTabs,
    groups,
    excludedTabIds,
    sortMode,
    groupMode,
    aggregationThreshold,
    t
  ]);

  /** 浏览器原生固定标签单独提取，渲染在搜索栏正下方 */
  const pinnedSection = useMemo(() => allSections.find((s) => s.kind === 'pinned'), [allSections]);
  const restSections = useMemo(() => allSections.filter((s) => s.kind !== 'pinned'), [allSections]);
  const pinnedSortableIds = useMemo(
    () => pinnedSection?.tabs.map((tab) => tab.id) ?? [],
    [pinnedSection]
  );

  const collapsedGroupIds = useMemo(
    () => new Set(groups.filter((group) => group.collapsed).map((group) => group.id)),
    [groups]
  );
  // 搜索时强制展开所有折叠分组/站点，确保命中标签可见。
  // 仅覆盖「展示用」折叠集合，不改动已存储的折叠偏好；清空搜索即原样还原。
  const displayCollapsedGroups = isFiltering ? EMPTY_COLLAPSED_GROUPS : collapsedGroupIds;
  const displayCollapsedSites: ReadonlySet<string> | readonly string[] = isFiltering
    ? EMPTY_COLLAPSED_SITES
    : collapsedSites;

  const collapsibleSections = useMemo(
    () => restSections.filter((section) => section.kind === 'native' || section.kind === 'site'),
    [restSections]
  );

  const allSectionsCollapsed =
    collapsibleSections.length > 0 &&
    collapsibleSections.every((section) =>
      section.kind === 'native'
        ? displayCollapsedGroups.has(section.groupId)
        : displayCollapsedSites.includes(section.siteKey)
    );

  const handleToggleAllSections = useCallback(() => {
    const shouldCollapse = !allSectionsCollapsed;
    for (const section of collapsibleSections) {
      if (section.kind === 'native') {
        void setGroupCollapsed(section.groupId, shouldCollapse);
      } else {
        void toggleSiteCollapsed(section.siteKey, shouldCollapse);
      }
    }
  }, [allSectionsCollapsed, collapsibleSections, setGroupCollapsed, toggleSiteCollapsed]);

  return {
    baseSections,
    pinnedSection,
    restSections,
    pinnedSortableIds,
    displayCollapsedGroups,
    displayCollapsedSites,
    collapsibleSections,
    allSectionsCollapsed,
    handleToggleAllSections
  };
}
