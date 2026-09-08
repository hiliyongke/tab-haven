import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { aggregateBySite, subLabel, type SiteSubGroup } from '@/core/site/SiteGrouping';
import type { SiteKey } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';
import { domainToUnicode } from '@/core/url/punycode';

export type { SiteSubGroup } from '@/core/site/SiteGrouping';

/**
 * 临时区视图模型：把标签镜像派生为侧边栏可渲染的 section 列表。
 *
 * section 顺序（行为规格）：
 *   固定标签区（置顶）→ 原生标签组 → 网站聚合组 → 未分组。
 * 固定空间的排除（文件夹挂起/绑定）由 excludedTabIds 传入（数据层接入后填充）。
 */

export type TemporarySection =
  | { kind: 'pinned'; key: string; title: string; tabs: TabRecord[] }
  | {
      kind: 'native';
      key: string;
      title: string;
      tabs: TabRecord[];
      groupId: number;
      color?: string;
      collapsed: boolean;
      /** 来源树模式下按标签 id 记录的缩进层级。 */
      depths?: ReadonlyMap<number, number>;
    }
  | {
      kind: 'site';
      key: string;
      title: string;
      tabs: TabRecord[];
      siteKey: string;
      /** 多子域时的折叠子分组；单子域时为长度 0。 */
      subgroups: SiteSubGroup[];
      /**
       * 因同站点归并而吸收进本分区的原生组 id（见 collectSiteMergeCandidates）。
       * 自动分组据此把同站点未分组标签并入既有原生组，而不是另建重复域名组。
       */
      mergedGroupIds?: readonly number[];
      /** 来源树模式下按标签 id 记录的缩进层级。 */
      depths?: ReadonlyMap<number, number>;
    }
  | {
      kind: 'ungrouped';
      key: string;
      title: string;
      tabs: TabRecord[];
      /** 来源树模式下按标签 id 记录的缩进层级。 */
      depths?: ReadonlyMap<number, number>;
    };

interface SectionDerivation {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  /** 从临时区排除的标签（固定空间挂起/绑定、手动移出等）。 */
  excludedTabIds?: ReadonlySet<number>;
  /** 排序方式：browser 原生顺序 / recency 最近访问优先。 */
  sortMode?: 'browser' | 'recency';
  /** 非固定标签聚合模式：site 按网站 / opener 按来源树 / language 按语言。 */
  groupMode?: 'site' | 'opener' | 'language';
  /** 网站聚合成组阈值（同注册域达到该数量才成组），默认 2。 */
  threshold?: number;
  /**
   * 文案翻译函数（可选）。core 不依赖 i18n，调用方（UI）注入 i18next 的 t。
   * 缺省回退为恒等函数，便于纯逻辑单测（标题退化为 i18n key，不影响分区结构）。
   */
  translate?: (key: string) => string;
}

/** 常见语言的 BCP-47 代码 → 展示名（其余回退为大写代码）。 */
const LANGUAGE_LABELS: Record<string, string> = {
  'zh-CN': '中文（简体）',
  'zh-TW': '中文（繁体）',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  ar: 'العربية'
};
function languageLabel(code: string, t: (key: string) => string): string {
  if (code === 'unknown') return t('sections.unknownLanguage');
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

/**
 * 由 openerTabId 构建来源树：把 opener 也在当前集合内的标签挂在父节点下，
 * 其余作为根（depth 0）。返回按 DFS 前序排列的标签与每层缩进深度。
 *
 * 健壮性：
 *  - 迭代式 DFS，避免极端长 opener 链递归栈溢出；
 *  - opener 自引用（openerTabId === id）按根处理；
 *  - opener 关系成环（A.opener=B 且 B.opener=A，可用 chrome.tabs.create 构造或
 *    会话恢复数据异常）时环上节点没有根可达路径，DFS 后按 index 补为 depth 0 根，
 *    保证任何标签都不会从侧边栏消失；
 *  - 子节点固定按浏览器顺序（index）排列：树结构按 recency 排序会打散层级，
 *    因此 sortMode 对 opener 模式不生效（有意取舍）。
 */
function buildOpenerTree(tabs: readonly TabRecord[]): {
  ordered: TabRecord[];
  depths: Map<number, number>;
} {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const childrenOf = new Map<number | undefined, TabRecord[]>();
  const pushChild = (parentId: number | undefined, tab: TabRecord) => {
    const list = childrenOf.get(parentId);
    if (list) list.push(tab);
    else childrenOf.set(parentId, [tab]);
  };
  for (const tab of tabs) {
    const opener = tab.openerTabId;
    const parent =
      opener !== undefined && opener !== tab.id && byId.has(opener) ? opener : undefined;
    pushChild(parent, tab);
  }

  const ordered: TabRecord[] = [];
  const depths = new Map<number, number>();
  const visited = new Set<number>();
  const walkRoots = (roots: readonly TabRecord[], depth: number) => {
    const sorted = roots.filter((tab) => !visited.has(tab.id)).sort((a, b) => a.index - b.index);
    const stack: Array<{ tab: TabRecord; depth: number }> = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) stack.push({ tab: sorted[i]!, depth });
    while (stack.length > 0) {
      const { tab, depth: current } = stack.pop()!;
      if (visited.has(tab.id)) continue;
      visited.add(tab.id);
      depths.set(tab.id, current);
      ordered.push(tab);
      const children = (childrenOf.get(tab.id) ?? [])
        .filter((child) => !visited.has(child.id))
        .sort((a, b) => a.index - b.index);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push({ tab: children[i]!, depth: current + 1 });
      }
    }
  };
  walkRoots(childrenOf.get(undefined) ?? [], 0);
  // 成环/孤儿节点兜底：按 index 补为 depth 0 根。
  if (visited.size < tabs.length) walkRoots(tabs, 0);
  return { ordered, depths };
}

/** 同站点归并候选：一个"本质上是站点组"的原生组及其成员的站点坐标。 */
interface SiteMergeCandidate {
  groupId: number;
  registrableDomain: string;
  subdomain: string;
  /** 组内成员（非固定、未被固定空间排除），deriveSections 的排序已应用。 */
  memberTabs: TabRecord[];
}

/**
 * 同站点归并候选识别：找出"域名命名的同站点原生组"。
 *
 * 背景 bug：原生组标题是建组时的域名快照；此后标签跨域导航、或同站点新标签以
 * 未分组状态打开时，同一站点的标签会同时出现在「原生组」与「站点聚合组」两处，
 * 表现为同一域名出现两个分组（碎片化）。
 *
 * 归并条件（保守，只吸收本质上是站点组的原生组）：
 *  1. 组内所有成员解析为同一 (注册域, 子域)；
 *  2. 组标题 === 该站点的展示标签（即域名命名的组；用户自定义名如「工作」绝不归并，
 *     标题漂移的组——成员已不在标题所指站点——同样不满足条件 1，不会归并）；
 *  3. 未分组标签中存在同一 (注册域, 子域) 的标签（确有碎片化才归并）。
 *
 * 归并只调整展示分区（成员并入站点分区渲染），不改动浏览器侧任何分组状态。
 */
function collectSiteMergeCandidates(
  groupsByFirstTab: ReadonlyArray<{ group: TabGroupRecord; groupTabs: TabRecord[] }>,
  eligible: readonly TabRecord[]
): SiteMergeCandidate[] {
  const eligibleSiteKeys = new Set<string>();
  for (const tab of eligible) {
    const site = tab.url ? siteResolver.resolve(tab.url) : null;
    if (site) eligibleSiteKeys.add(`${site.registrableDomain}|${site.subdomain}`);
  }
  const candidates: SiteMergeCandidate[] = [];
  for (const { group, groupTabs } of groupsByFirstTab) {
    if (!group.title) continue;
    let first: SiteKey | null = null;
    let sameSite = true;
    for (const tab of groupTabs) {
      const site = tab.url ? siteResolver.resolve(tab.url) : null;
      if (!site) {
        sameSite = false;
        break;
      }
      if (!first) {
        first = site;
        continue;
      }
      if (
        site.registrableDomain !== first.registrableDomain ||
        site.subdomain !== first.subdomain
      ) {
        sameSite = false;
        break;
      }
    }
    if (!sameSite || !first) continue;
    const siteLabel = domainToUnicode(subLabel(first.subdomain, first.registrableDomain));
    if (group.title !== siteLabel) continue;
    if (!eligibleSiteKeys.has(`${first.registrableDomain}|${first.subdomain}`)) continue;
    candidates.push({
      groupId: group.id,
      registrableDomain: first.registrableDomain,
      subdomain: first.subdomain,
      memberTabs: groupTabs
    });
  }
  return candidates;
}

interface SitePlan {
  /** 站点分区（顺序与 aggregateBySite 输出一致）。 */
  sections: Extract<TemporarySection, { kind: 'site' }>[];
  /** 未成组的独立标签。 */
  singles: TabRecord[];
  /** 已被站点分区吸收的原生组 id（这些组不再单独成区）。 */
  absorbedGroupIds: Set<number>;
}

/**
 * 站点聚合 + 同站点归并：先按未分组标签聚合，再把候选原生组成员追加进
 * 对应站点分区（必须有同 (注册域, 子域) 的分区/子分组才吸收——不改变聚合阈值
 * 与 singles 判定，避免把原生组标签挤进「未分组」）。
 */
function buildSitePlan({
  eligible,
  threshold,
  candidates,
  sortCmp
}: {
  eligible: readonly TabRecord[];
  threshold: number | undefined;
  candidates: readonly SiteMergeCandidate[];
  sortCmp: (a: TabRecord | undefined, b: TabRecord | undefined) => number;
}): SitePlan {
  const { groups: siteGroups, singles } = aggregateBySite(eligible, { threshold });
  const absorbedGroupIds = new Set<number>();
  for (const candidate of candidates) {
    const target = siteGroups.find((group) => {
      if (group.key.registrableDomain !== candidate.registrableDomain) return false;
      // 折叠模式按子分组匹配；单子域/自动展开模式整个分区即该子域。
      return group.subgroups.length > 0
        ? group.subgroups.some((sub) => sub.subdomain === candidate.subdomain)
        : group.key.subdomain === candidate.subdomain;
    });
    if (!target) continue;
    absorbedGroupIds.add(candidate.groupId);
    if (target.subgroups.length > 0) {
      const sub = target.subgroups.find((s) => s.subdomain === candidate.subdomain)!;
      sub.tabs = [...sub.tabs, ...candidate.memberTabs].sort(sortCmp);
      target.tabs = target.subgroups.flatMap((s) => s.tabs);
    } else {
      target.tabs = [...target.tabs, ...candidate.memberTabs].sort(sortCmp);
    }
  }
  const sections = siteGroups.map((group) => ({
    kind: 'site' as const,
    key: `site-${group.key.value}`,
    title: group.key.label,
    tabs: group.tabs,
    siteKey: group.key.value,
    subgroups: group.subgroups,
    mergedGroupIds: candidates
      .filter((candidate) => absorbedGroupIds.has(candidate.groupId))
      .filter((candidate) => group.tabs.some((tab) => tab.id === candidate.memberTabs[0]!.id))
      .map((candidate) => candidate.groupId)
  }));
  return { sections, singles, absorbedGroupIds };
}

export function deriveSections({
  tabs,
  groups,
  excludedTabIds,
  sortMode = 'browser',
  groupMode = 'site',
  threshold,
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
      title: t('sections.pinned'),
      tabs: pinnedTabs
    });
  }

  // 原生标签组：组内标签按排序规则，排除绑定到固定空间的标签与固定标签。
  // 先按 groupId 单次分桶再排序：原先在 groups.map 内对每个组 filter 全量标签，
  // 复杂度 O(组数 × 标签数)（200 组 × 1000 标签 = 20 万次比较 + 200 次数组分配）。
  const tabsByGroup = new Map<number, TabRecord[]>();
  for (const tab of tabs) {
    if (tab.pinned || tab.groupId === NO_GROUP || excluded.has(tab.id)) continue;
    const list = tabsByGroup.get(tab.groupId);
    if (list) list.push(tab);
    else tabsByGroup.set(tab.groupId, [tab]);
  }
  const groupsByFirstTab = groups
    .map((group) => ({ group, groupTabs: (tabsByGroup.get(group.id) ?? []).sort(sortCmp) }))
    .filter(({ groupTabs }) => groupTabs.length > 0)
    .sort((a, b) => sortCmp(a.groupTabs[0], b.groupTabs[0]));

  // 非固定、未分组标签（固定标签与原生组已单独分区）。
  const eligible = tabs
    .filter((tab) => !tab.pinned && tab.groupId === NO_GROUP && !excluded.has(tab.id))
    .sort(sortCmp);

  // 站点模式先完成聚合与同站点归并：吸收结果决定哪些"域名命名的同站点原生组"
  // 不再单独成区（消除同一域名出现原生组 + 站点组两个分区的碎片化）。
  // opener/language 模式不做归并，原生组照常渲染。
  const sitePlan =
    groupMode === 'site'
      ? buildSitePlan({
          eligible,
          threshold,
          candidates: collectSiteMergeCandidates(groupsByFirstTab, eligible),
          sortCmp
        })
      : null;

  for (const { group, groupTabs } of groupsByFirstTab) {
    if (sitePlan?.absorbedGroupIds.has(group.id)) continue;
    sections.push({
      kind: 'native',
      key: `group-${group.id}`,
      title: group.title || t('tabs.unnamedGroup'),
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
        title: t('sections.openerTree'),
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
    for (const tab of eligible) pushLang(tab.language || 'unknown', tab);
    for (const code of [...byLang.keys()].sort()) {
      sections.push({
        kind: 'site',
        key: `lang-${code}`,
        title: languageLabel(code, t),
        tabs: byLang.get(code) ?? [],
        siteKey: `lang-${code}`,
        subgroups: []
      });
    }
    return sections;
  }

  // 站点聚合 + 未分组（默认）。子域密度自动展开与同站点归并由 buildSitePlan 处理。
  if (sitePlan) {
    sections.push(...sitePlan.sections);
    if (sitePlan.singles.length > 0) {
      sections.push({
        kind: 'ungrouped',
        key: 'ungrouped',
        title: t('tabs.ungrouped'),
        tabs: sitePlan.singles
      });
    }
  }

  return sections;
}
