import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { siteGroupingPolicyFor } from '@/core/site/SiteKey';
import {
  buildOpenerTree,
  buildSitePlan,
  collectSiteMergeCandidates,
  splitNativeGroupDrift
} from './sectionDerivation';
import {
  LANG_SITE_KEY_PREFIX,
  MIN_LANGUAGE_GROUP_SIZE,
  languageLabel,
  makeLangSiteKey,
  normalizeLanguageCode,
  parseLangSiteKey
} from './sectionLang';
import type { SectionDerivation, TemporarySection } from './sectionTypes';

// 保持 @/core/site/Sections 的既有导出名不变（下游按该路径引用）。
export { LANG_SITE_KEY_PREFIX, MIN_LANGUAGE_GROUP_SIZE, parseLangSiteKey };
export type { TemporarySection };

/**
 * 临时区视图模型：把标签镜像派生为侧边栏可渲染的 section 列表。
 *
 * section 顺序：固定标签区（置顶）→ 原生标签组 → 网站聚合组 → 未分组。
 * 固定空间的排除（文件夹挂起/绑定）由 excludedTabIds 传入（数据层接入后填充）。
 */

/**
 * 派生临时分区：把「固定空间之外」的标签切成若干展示区块。
 *
 * none 模式短路为「固定 → 全部标签」；其余模式顺序恒为：
 * 浏览器固定 → 原生标签组 → 站点聚合（仅 site / rootDomain）→ 未分组。
 * 分区是渲染期派生的临时结构，不落盘；固定空间由调用方另行拼接。
 *
 * 边界：分组信息缺失的标签按未分组处理而非丢弃——跨窗口搜索时 groups 只含当前窗口，
 * 若当作「已入组」排除，这些标签会既不在原生区也不在未分组，从列表里凭空消失。
 */
export function deriveSections({
  tabs,
  groups,
  excludedTabIds,
  sortMode = 'browser',
  groupMode = 'site',
  threshold,
  splitDriftedNativeTabs = true,
  translate
}: SectionDerivation): TemporarySection[] {
  const t = translate ?? ((key: string) => key);
  const excluded = excludedTabIds ?? new Set<number>();
  const sortCmp = (a: TabRecord | undefined, b: TabRecord | undefined): number =>
    sortMode === 'recency'
      ? (b?.lastAccessed ?? 0) - (a?.lastAccessed ?? 0)
      : (a?.index ?? 0) - (b?.index ?? 0);
  const sections: TemporarySection[] = [];

  // 固定标签区（置顶，独立成区，不混入原生组/站点组/未分组）。
  const pinnedTabs = tabs
    .filter((tab) => tab.pinned && !excluded.has(tab.id))
    .sort((a, b) => a.index - b.index);
  if (pinnedTabs.length > 0) {
    sections.push({
      kind: 'pinned',
      key: 'pinned',
      title: t('浏览器固定标签'),
      tabs: pinnedTabs
    });
  }

  // 不分组模式：所有未固定标签（含原生组成员）平铺在一个区块，短路后续分桶。
  // 必须在原生组分区之前返回，否则组内标签会被分走而从这个列表里消失。
  if (groupMode === 'none') {
    const flat = tabs.filter((tab) => !tab.pinned && !excluded.has(tab.id)).sort(sortCmp);
    if (flat.length > 0) {
      sections.push({
        kind: 'ungrouped',
        key: 'ungrouped',
        title: t('全部标签'),
        tabs: flat
      });
    }
    return sections;
  }

  // 原生标签组：组内标签按排序规则，排除绑定到固定空间的标签与固定标签。
  // 先按 groupId 单次分桶再排序：在 groups.map 内对每个组 filter 全量标签则
  // 复杂度 O(组数 × 标签数)（200 组 × 1000 标签 = 20 万次比较 + 200 次数组分配）。
  // 已知原生组 id：分组信息缺失的标签不能被当作「已入组」丢掉（见 eligible 注释）。
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const tabsByGroup = new Map<number, TabRecord[]>();
  for (const tab of tabs) {
    if (tab.pinned || tab.groupId === NO_GROUP || excluded.has(tab.id)) continue;
    if (!knownGroupIds.has(tab.groupId)) continue;
    const list = tabsByGroup.get(tab.groupId);
    if (list) list.push(tab);
    else tabsByGroup.set(tab.groupId, [tab]);
  }
  const groupsByFirstTab = groups
    .map((group) => ({ group, groupTabs: (tabsByGroup.get(group.id) ?? []).sort(sortCmp) }))
    .filter(({ groupTabs }) => groupTabs.length > 0)
    .sort((a, b) => sortCmp(a.groupTabs[0], b.groupTabs[0]));

  // 非固定、未分组标签（固定标签与原生组已单独分区）。
  // groupId 不在 groups 里的标签同样按未分组处理：跨窗口搜索时 filteredTabs 含
  // 其他窗口标签，而 groups 只含当前窗口 —— 若按「已入组」排除，这些标签既不在
  // 原生区也不在未分组，会从列表里凭空消失（与搜索命中数自相矛盾）。
  // 代价：下游 core/group/AutoGrouping 必须区分「确实未分组」与「分组信息不可知」，
  // 后者不得参与新建原生组（否则会覆盖浏览器侧既有归属），见 planAutoGroups 注释。
  const eligible = tabs
    .filter(
      (tab) =>
        !tab.pinned &&
        (tab.groupId === NO_GROUP || !knownGroupIds.has(tab.groupId)) &&
        !excluded.has(tab.id)
    )
    .sort(sortCmp);

  // 按聚合模式选取站点身份策略：分桶、同站点归并、漂移拆分、自动建组共用同一口径。
  // 非站点聚合模式（opener / language）没有策略，原生组分区原样保留。
  const policy = siteGroupingPolicyFor(groupMode);
  // 拆出被 Chrome 组继承「粘」在旧域名原生组里的跨域标签，让它们按自身域名参与聚合。
  // 不改 groupId：只调整展示分区（见 splitNativeGroupDrift 注释）。
  const { visibleNativeGroups, detachedTabs, detachedGroupIds } = splitNativeGroupDrift(
    groupsByFirstTab,
    splitDriftedNativeTabs ? policy : null
  );
  const aggregationEligible =
    detachedTabs.length > 0 ? [...eligible, ...detachedTabs].sort(sortCmp) : eligible;

  // 站点聚合 + 同站点归并：仅 site / rootDomain 模式执行。本轮被拆过的组不参与归并：
  // 组状态刚变化，保守起见不把「看起来已纯净」的组立刻吸收，避免与下一帧快照来回搬动。
  const sitePlan =
    policy === null
      ? null
      : buildSitePlan({
          eligible: aggregationEligible,
          threshold,
          policy,
          candidates: collectSiteMergeCandidates(
            visibleNativeGroups,
            aggregationEligible,
            policy
          ).filter((candidate) => !detachedGroupIds.has(candidate.groupId)),
          sortCmp
        });

  for (const { group, groupTabs } of visibleNativeGroups) {
    if (sitePlan?.absorbedGroupIds.has(group.id)) continue;
    sections.push({
      kind: 'native',
      key: `group-${group.id}`,
      title: group.title || t('未命名标签组'),
      tabs: groupTabs,
      groupId: group.id,
      color: group.color,
      collapsed: group.collapsed ?? false
    });
  }

  // 来源树模式：按 openerTabId 缩进成树。
  if (groupMode === 'opener') {
    const { ordered, depths } = buildOpenerTree(eligible);
    if (ordered.length > 0) {
      sections.push({
        kind: 'ungrouped',
        key: 'opener-tree',
        title: t('来源树'),
        tabs: ordered,
        depths
      });
    }
    return sections;
  }

  // 语言模式：按 detectLanguage 探测到的语言分组（无语言信息时归为 unknown）。
  if (groupMode === 'language') {
    const byLang = new Map<string, TabRecord[]>();
    const pushLang = (code: string, tab: TabRecord) => {
      const list = byLang.get(code);
      if (list) list.push(tab);
      else byLang.set(code, [tab]);
    };
    for (const tab of eligible) pushLang(normalizeLanguageCode(tab.language), tab);
    for (const code of [...byLang.keys()].sort()) {
      const siteKey = makeLangSiteKey(code);
      sections.push({
        kind: 'site',
        key: siteKey,
        title: languageLabel(code, t),
        tabs: byLang.get(code) ?? [],
        siteKey
      });
    }
    return sections;
  }

  // 站点聚合 + 未分组（site / rootDomain）。分桶与同站点归并由 buildSitePlan 按策略处理。
  if (sitePlan) {
    sections.push(...sitePlan.sections);
    if (sitePlan.singles.length > 0) {
      sections.push({
        kind: 'ungrouped',
        key: 'ungrouped',
        title: t('未分组'),
        tabs: sitePlan.singles
      });
    }
  }

  return sections;
}
