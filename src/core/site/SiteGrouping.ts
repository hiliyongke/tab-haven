import type { TabRecord } from '@/core/tab-types';
import type { SiteKey } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';

/**
 * 站点聚合：把一组标签按归组键聚合为"站点组 + 独立标签"。
 *
 * 行为规格（PRD 附录 C-4 / FR-D3.1）：
 *  - 同注册域标签达到阈值（默认 2）成组，未达阈值归独立；
 *  - 排除集（用户手动移出的标签）永不参与聚合；
 *  - 多级子域名智能识别：注册域内按子域再分亚组，单子域多标签时扁平展示，
 *    多子域时主组标题用注册域、可折叠展开各子域分组（兼顾层级）；
 *  - 组按组内首标签的位置排序。
 */

export interface SiteSubGroup {
  /** 子域部分（不含 www；裸域为空串）。 */
  subdomain: string;
  /** 展示标签（子域.注册域 或裸注册域）。 */
  label: string;
  tabs: TabRecord[];
}

export interface SiteGroup {
  key: SiteKey;
  /** 组内全部标签（兼容字段）。 */
  tabs: TabRecord[];
  /** 按子域再分的亚组；仅当组内存在多个不同子域时非空（用于折叠展示）。 */
  subgroups: SiteSubGroup[];
}

export interface SiteAggregation {
  groups: SiteGroup[];
  singles: TabRecord[];
}

export interface AggregationOptions {
  /** 成组阈值，默认 2。 */
  threshold?: number;
  /** 排除的标签 id（手动移出），永不聚合。 */
  excludedTabIds?: ReadonlySet<number>;
}

/** 单子域分组展示标签：裸域为注册域，否则 "子域.注册域"。 */
function subLabel(subdomain: string, registrableDomain: string): string {
  return subdomain ? `${subdomain}.${registrableDomain}` : registrableDomain;
}

export function aggregateBySite(
  tabs: readonly TabRecord[],
  options: AggregationOptions = {}
): SiteAggregation {
  const threshold = options.threshold ?? 2;
  const excluded = options.excludedTabIds ?? new Set<number>();

  // 第一层：按注册域归组
  const domainBuckets = new Map<string, { key: SiteKey; tabs: TabRecord[] }>();
  const singles: TabRecord[] = [];

  for (const tab of tabs) {
    if (excluded.has(tab.id)) {
      singles.push(tab);
      continue;
    }
    const key = tab.url ? siteResolver.resolve(tab.url) : null;
    if (!key) {
      singles.push(tab);
      continue;
    }
    const bucket = domainBuckets.get(key.value) || { key, tabs: [] };
    bucket.tabs.push(tab);
    domainBuckets.set(key.value, bucket);
  }

  const groups: SiteGroup[] = [];
  for (const bucket of domainBuckets.values()) {
    if (bucket.tabs.length < threshold) {
      singles.push(...bucket.tabs);
      continue;
    }

    // 第二层：注册域内按子域分亚组
    const subBuckets = new Map<string, TabRecord[]>();
    for (const tab of bucket.tabs) {
      const sub = tab.url ? siteResolver.resolve(tab.url)?.subdomain ?? '' : '';
      const arr = subBuckets.get(sub) || [];
      arr.push(tab);
      subBuckets.set(sub, arr);
    }

    const subgroups: SiteSubGroup[] =
      subBuckets.size > 1
        ? [...subBuckets.entries()]
            .map(([sub, subTabs]) => ({
              subdomain: sub,
              label: subLabel(sub, bucket.key.registrableDomain),
              tabs: subTabs
            }))
            .sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0))
        : [];

    groups.push({ key: bucket.key, tabs: bucket.tabs, subgroups });
  }
  groups.sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0));

  return { groups, singles };
}
