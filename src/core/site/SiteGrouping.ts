import type { TabRecord } from '@/core/tab-types';
import type { SiteKey } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';

/**
 * 站点聚合：把一组标签按归组键聚合为"站点组 + 独立标签"。
 *
 * 行为规格（PRD 附录 C-4 / FR-D3.1）：
 *  - 同键标签达到阈值（默认 2）成组，未达阈值归独立；
 *  - 排除集（用户手动移出的标签）永不参与聚合；
 *  - 组按组内首标签的位置排序。
 */

export interface SiteGroup {
  key: SiteKey;
  tabs: TabRecord[];
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

export function aggregateBySite(
  tabs: readonly TabRecord[],
  options: AggregationOptions = {}
): SiteAggregation {
  const threshold = options.threshold ?? 2;
  const excluded = options.excludedTabIds ?? new Set<number>();

  const buckets = new Map<string, SiteGroup>();
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
    const bucket = buckets.get(key.value) || { key, tabs: [] };
    bucket.tabs.push(tab);
    buckets.set(key.value, bucket);
  }

  const groups: SiteGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.tabs.length >= threshold) {
      groups.push(bucket);
    } else {
      singles.push(...bucket.tabs);
    }
  }
  groups.sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0));

  return { groups, singles };
}
