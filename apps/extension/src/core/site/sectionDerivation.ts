import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import { aggregateBySite } from '@/core/site/SiteGrouping';
import { DEFAULT_AGGREGATION_THRESHOLD } from '@/core/schema/models';
import type { SiteGroupingPolicy, SiteKey } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';
import { hostnameOf } from '@/core/url/UrlInspector';
import { hasPunycodeLabel } from '@/core/url/punycode';
import type {
  NativeGroupDrift,
  NativeGroupEntry,
  SiteMergeCandidate,
  SitePlan
} from './sectionTypes';

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
export function buildOpenerTree(tabs: readonly TabRecord[]): {
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

/** 展示层站点标签：只用已提交的 url；身份口径由策略决定，无 URL 返回 null。 */
function nativeTabSiteLabel(tab: TabRecord, policy: SiteGroupingPolicy): string | null {
  const site = tab.url ? siteResolver.resolve(tab.url) : null;
  return site ? policy.label(site) : null;
}

/**
 * 组标题是否为「该策略下域名命名的组」：把标题还原成站点，能按策略标签原样还原才算。
 * 判据只看标题本身，不看组内成员 —— 组内同域名成员可能被固定空间排除、已关闭或不在
 * 当前快照里；若要求「组内必须有锚点」，跨域新标签反而会成为该组唯一可见成员。
 * 中文自定义名会被 URL 转成 punycode，显式排除，避免误判成域名组。
 * 策略参与判定：根域名模式下标题须是注册域，旧的子域名组整组保留、不被误拆。
 */
export function isDomainNamedGroupTitle(title: string, policy: SiteGroupingPolicy): boolean {
  if (/\s/.test(title)) return false;
  const rawUrl = `https://${title}`;
  const hostname = hostnameOf(rawUrl);
  if (hostname === undefined || hasPunycodeLabel(hostname)) return false;
  const site = siteResolver.resolve(rawUrl);
  return site !== null && policy.label(site) === title;
}

/**
 * 拆出「域名命名的原生组」里域名与组标题不符的成员。
 *
 * Chrome 会把「从组内标签点开的链接」自动加入同一个原生组，这类跨域新标签一出生就带
 * groupId；若原样渲染，它们会永久挂在旧域名标题的分区里，再也进不了域名分桶。
 * 拆分与同站点归并一样只调整展示分区，不改动浏览器侧任何分组状态（见
 * collectSiteMergeCandidates 注释）。
 *
 * 保守边界：
 *  - 组标题必须能按策略还原成站点标签（域名命名的组），自定义命名/未命名组整组保留；
 *  - URL 尚未提交时无法判定，成员留在原组，等下一次快照再拆；
 *  - 整组都是漂移成员时不渲染空分区；
 *  - 仅按站点聚合的模式生效；policy 为 null（含对账视图）时保留真实组成员。
 */
export function splitNativeGroupDrift(
  groupsByFirstTab: readonly NativeGroupEntry[],
  policy: SiteGroupingPolicy | null
): NativeGroupDrift {
  const detachedTabs: TabRecord[] = [];
  const detachedGroupIds = new Set<number>();
  if (policy === null) {
    return { visibleNativeGroups: [...groupsByFirstTab], detachedTabs, detachedGroupIds };
  }
  const visibleNativeGroups: NativeGroupEntry[] = [];
  for (const { group, groupTabs } of groupsByFirstTab) {
    const title = group.title;
    if (!title || !isDomainNamedGroupTitle(title, policy)) {
      visibleNativeGroups.push({ group, groupTabs });
      continue;
    }
    const kept: TabRecord[] = [];
    for (const tab of groupTabs) {
      const label = nativeTabSiteLabel(tab, policy);
      if (label !== null && label !== title) {
        detachedTabs.push(tab);
        detachedGroupIds.add(group.id);
      } else {
        kept.push(tab);
      }
    }
    // 整组都是漂移成员时不渲染空分区：拆出的标签已按自身域名参与聚合。
    if (kept.length > 0) visibleNativeGroups.push({ group, groupTabs: kept });
  }
  return { visibleNativeGroups, detachedTabs, detachedGroupIds };
}

/**
 * 同站点归并候选识别：找出"域名命名的同站点原生组"。
 * 原生组标题是创建时的域名快照，可能与当前成员站点不一致；归并条件确保仅将同站点标签
 * 合并到站点分区，避免相同域名同时显示在原生组与站点聚合组中。
 *
 * 归并条件（保守，只吸收本质上是站点组的原生组）：
 *  1. 组内所有成员解析为同一站点桶（本地/IP 含端口）；
 *  2. 组标题 === 该站点的展示标签（即域名命名的组；用户自定义名如「工作」绝不归并，
 *     标题漂移的组——成员已不在标题所指站点——同样不满足条件 1，不会归并）；
 *  3. 未分组标签中存在同一站点桶的标签（确有碎片化才归并）。
 *
 * 归并只调整展示分区（成员并入站点分区渲染），不改动浏览器侧任何分组状态。
 */
export function collectSiteMergeCandidates(
  groupsByFirstTab: ReadonlyArray<{ group: TabGroupRecord; groupTabs: TabRecord[] }>,
  eligible: readonly TabRecord[],
  policy: SiteGroupingPolicy
): SiteMergeCandidate[] {
  const eligibleBucketIds = new Set<string>();
  for (const tab of eligible) {
    const site = tab.url ? siteResolver.resolve(tab.url) : null;
    if (site) eligibleBucketIds.add(policy.bucketId(site));
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
      // 必须比较策略口径下的完整分桶键：端口属于本地/IP 的站点身份；
      // 根域名模式下同注册域不同子域才算同站点。
      if (policy.bucketId(site) !== policy.bucketId(first)) {
        sameSite = false;
        break;
      }
    }
    if (!sameSite || !first) continue;
    // 组标题与自动建组时的标题同口径（aggregateBySite 的 groupKey.label）。
    // 策略参与判定，否则根域名组的子域成员会被当成漂移、归并整体失效。
    if (group.title !== policy.label(first)) continue;
    const bucketId = policy.bucketId(first);
    if (!eligibleBucketIds.has(bucketId)) continue;
    candidates.push({
      groupId: group.id,
      bucketId,
      sourceKey: first,
      memberTabs: groupTabs
    });
  }
  return candidates;
}

/**
 * 站点聚合 + 同站点归并：先按未分组标签聚合，再把候选原生组成员并入
 * 对应站点分区。
 *
 * 归并判定口径 = 「该站点在临时区的全部标签」（未分组标签 + 同站点原生组成员）
 * 达到聚合阈值：
 *  - 未分组侧自身已达阈值 → 分区已存在，直接吸收原生组成员；
 *  - 未分组侧不足阈值、但加上原生组成员后总数达阈值 → 新建站点分区并把
 *    未分组标签一并纳入（否则浏览器里已有同站点原生组时，新打开的同站点
 *    标签会一直滞留「未分组」，而「重排分组」却能修好——两条路径口径必须一致）；
 *  - 总数仍不足阈值 → 保持原样（原生组与未分组标签各自渲染，不拆不并）。
 * 任何分支都不把原生组标签挤进「未分组」。
 */
export function buildSitePlan({
  eligible,
  threshold,
  candidates,
  policy,
  sortCmp
}: {
  eligible: readonly TabRecord[];
  threshold: number | undefined;
  candidates: readonly SiteMergeCandidate[];
  policy: SiteGroupingPolicy;
  sortCmp: (a: TabRecord | undefined, b: TabRecord | undefined) => number;
}): SitePlan {
  const effectiveThreshold = threshold ?? DEFAULT_AGGREGATION_THRESHOLD;
  const { groups: siteGroups, singles } = aggregateBySite(eligible, { threshold, policy });
  const absorbedGroupIds = new Set<number>();
  for (const candidate of candidates) {
    // 分区与候选的「原始分桶键」精确匹配；展示键已被策略改写，不能拿来比较。
    const target = siteGroups.find((group) => group.bucketId === candidate.bucketId);
    if (target) {
      absorbedGroupIds.add(candidate.groupId);
      target.tabs = [...target.tabs, ...candidate.memberTabs].sort(sortCmp);
      continue;
    }
    // 未分组里该站点自身不足阈值 → 未形成站点分区。但归并的判定口径应当是
    // 「该站点在临时区的全部标签」＝ 未分组标签 + 同站点原生组成员：总数达阈值时
    // 仍归并成站点分区。否则浏览器里已存在同站点原生组时，新打开的同站点标签会
    // 一直滞留「未分组」——只有「重排分组」（planRegroup 把临时区标签全部视为
    // 未分组重聚合）才能修好，两条路径的判定口径必须一致。
    // 与分支 1、aggregateBySite 共用策略的 bucketId：口径不一致会把
    // localhost:3000 的候选与 localhost:8080 的未分组标签判成同站，
    // 于是 8080 的唯一标签被塞进 3000 的分区、从「未分组」平空消失。
    const sameSiteSingles = singles.filter((tab) => {
      const site = tab.url ? siteResolver.resolve(tab.url) : null;
      return site !== null && policy.bucketId(site) === candidate.bucketId;
    });
    if (sameSiteSingles.length === 0) continue;
    if (sameSiteSingles.length + candidate.memberTabs.length < effectiveThreshold) continue;
    // 从 singles 摘除：这些标签已进新分区，不能再在「未分组」重复渲染。
    const takenIds = new Set(sameSiteSingles.map((tab) => tab.id));
    for (let i = singles.length - 1; i >= 0; i -= 1) {
      if (takenIds.has(singles[i]!.id)) singles.splice(i, 1);
    }
    // 分区展示键与 aggregateBySite 同口径，均由策略派生。
    const groupKey: SiteKey = {
      value: policy.sectionKey(candidate.sourceKey),
      label: policy.label(candidate.sourceKey),
      registrableDomain: candidate.sourceKey.registrableDomain,
      subdomain: candidate.sourceKey.subdomain
    };
    siteGroups.push({
      key: groupKey,
      bucketId: candidate.bucketId,
      tabs: [...sameSiteSingles, ...candidate.memberTabs].sort(sortCmp)
    });
    absorbedGroupIds.add(candidate.groupId);
  }
  // 分区按组内最近访问时间降序排列，让最近使用的站点组靠前。
  // lastAccessed 由 tabStore 冻结，只在标签首次出现时刷新；时间戳缺失或相同时按浏览器顺序稳定排序。
  const latestAccessed = (tabs: readonly { lastAccessed?: number }[]) => {
    let latest = 0;
    for (const tab of tabs) {
      const at = tab.lastAccessed ?? 0;
      if (at > latest) latest = at;
    }
    return latest;
  };
  siteGroups.sort((a, b) => {
    const byRecency = latestAccessed(b.tabs) - latestAccessed(a.tabs);
    return byRecency !== 0 ? byRecency : (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0);
  });
  // 「已吸收候选者」与「每个站点组的标签 id 集合」预先算好：预建 Set 把
  // O(站点组 × 候选组 × 标签) 的三层嵌套降为 O(站点组 × 候选组)。
  const absorbedCandidates = candidates.filter((candidate) =>
    absorbedGroupIds.has(candidate.groupId)
  );
  const tabIdsByGroup = siteGroups.map((group) => new Set(group.tabs.map((tab) => tab.id)));
  const sections = siteGroups.map((group, groupIndex) => ({
    kind: 'site' as const,
    key: `site-${group.key.value}`,
    title: group.key.label,
    tabs: group.tabs,
    siteKey: group.key.value,
    mergedGroupIds: absorbedCandidates
      .filter((candidate) => {
        const headId = candidate.memberTabs[0]?.id;
        return headId !== undefined && tabIdsByGroup[groupIndex]!.has(headId);
      })
      .map((candidate) => candidate.groupId)
  }));
  return { sections, singles, absorbedGroupIds };
}
