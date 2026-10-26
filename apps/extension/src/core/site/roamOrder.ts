import type { TemporarySection } from '@/core/site/Sections';

/**
 * 键盘漫游序列（空查询态）：按列表显示顺序展开可见分区。
 *
 * 放 core 的理由：这是「分区 → 标签 id 序列」的纯派生（含折叠过滤），入参全是
 * `core/site/Sections` 的领域类型，零 chrome/DOM/React 依赖 —— 与
 * `core/layout/footerOrder` 的「顺序口径」同类。埋在 App 的 useMemo 里时
 * 无法单测，「折叠分区不进序列」这条规则只能靠手点验证。
 */

/** 漫游序列的入参（与侧边栏的显示态一一对应）。 */
export interface RoamOrderInput {
  /** 是否渲染常驻磁贴区（浏览器原生固定标签，置顶在搜索栏下方）。 */
  showPinnedStrip: boolean;
  /** 固定标签分区（未渲染时为 undefined）。 */
  pinnedSection: TemporarySection | undefined;
  /** 除固定区外的分区，按显示顺序。 */
  restSections: readonly TemporarySection[];
  /** 折叠的原生组 id。 */
  collapsedGroups: ReadonlySet<number>;
  /**
   * 折叠的站点分区 siteKey（含语言分区）。
   *
   * Set 或数组皆可：上游 `useSectionDerivation` 在非过滤态给的是 `readonly string[]`
   * （持久化集合），过滤态给的是模块级常量数组，这里统一成 Set 再查询。
   */
  collapsedSites: ReadonlySet<string> | readonly string[];
}

/**
 * 展开可见分区为漫游序列（标签 id，按显示顺序）。
 *
 * 折叠分区内的标签**不进序列**：它们在 DOM 里不存在，选中一个看不见的标签会让
 * Enter 变成「激活未知项」。
 */
export function buildRoamOrder(input: RoamOrderInput): number[] {
  const {
    showPinnedStrip,
    pinnedSection,
    restSections,
    collapsedGroups,
    collapsedSites: rawCollapsedSites
  } = input;
  const collapsedSites =
    rawCollapsedSites instanceof Set ? rawCollapsedSites : new Set(rawCollapsedSites);
  const ids: number[] = [];
  if (showPinnedStrip && pinnedSection) {
    for (const tab of pinnedSection.tabs) ids.push(tab.id);
  }
  for (const section of restSections) {
    const collapsed =
      section.kind === 'native'
        ? collapsedGroups.has(section.groupId)
        : section.kind === 'site'
          ? collapsedSites.has(section.siteKey)
          : false;
    if (collapsed) continue;
    for (const tab of section.tabs) ids.push(tab.id);
  }
  return ids;
}
