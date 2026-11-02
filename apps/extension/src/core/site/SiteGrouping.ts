import type { TabRecord } from '@/core/tab-types';
import { DEFAULT_AGGREGATION_THRESHOLD } from '@/core/schema/models';
import { SUBDOMAIN_POLICY, type SiteGroupingPolicy, type SiteKey } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';

/**
 * 站点聚合：把一组标签按策略分桶为"站点组 + 独立标签"。
 *
 *  - 同桶标签达到阈值（默认 2）成组，未达阈值归独立；
 *  - 排除集（用户手动移出的标签）永不参与聚合；
 *  - 组按组内首标签的位置排序；
 *  - 层级永远只有一级，不嵌套。
 *
 * 分桶口径由 SiteGroupingPolicy 决定：site 一子域一组，rootDomain 同注册域折叠。
 * 桶键与展示键分离：bucketId 保留原始解析结果，比较不受 sectionKey 改写影响。
 */

interface SiteGroup {
  /** 展示用站点键（value = sectionKey，label = 分区标题）。 */
  key: SiteKey;
  /** 原始分桶键，供同站点归并比较。 */
  bucketId: string;
  tabs: TabRecord[];
}

interface SiteAggregation {
  groups: SiteGroup[];
  singles: TabRecord[];
}

interface AggregationOptions {
  /** 成组阈值，默认 2。 */
  threshold?: number;
  /** 排除的标签 id（手动移出），永不聚合。 */
  excludedTabIds?: ReadonlySet<number>;
  /** 站点身份策略；缺省按一子域一组（site 口径）。 */
  policy?: SiteGroupingPolicy;
}

/**
 * 站点聚合：把标签切为「站点组 + 独立标签」，规则见文件头。
 * `threshold`（默认 2）为成组阈值；`excludedTabIds` 内的标签永不成组；
 * `policy` 决定分桶与标题口径，默认一子域一组。
 */
export function aggregateBySite(
  tabs: readonly TabRecord[],
  options: AggregationOptions = {}
): SiteAggregation {
  const threshold = options.threshold ?? DEFAULT_AGGREGATION_THRESHOLD;
  const excluded = options.excludedTabIds ?? new Set<number>();
  const policy = options.policy ?? SUBDOMAIN_POLICY;

  const buckets = new Map<string, { key: SiteKey; bucketId: string; tabs: TabRecord[] }>();
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
    const bucketId = policy.bucketId(key);
    let bucket = buckets.get(bucketId);
    if (!bucket) {
      bucket = { key, bucketId, tabs: [] };
      buckets.set(bucketId, bucket);
    }
    bucket.tabs.push(tab);
  }

  const groups: SiteGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.tabs.length < threshold) {
      singles.push(...bucket.tabs);
      continue;
    }
    // 展示键由策略派生；bucketId 仍用原始解析键，供下游同站点归并精确比较。
    const groupKey: SiteKey = {
      value: policy.sectionKey(bucket.key),
      label: policy.label(bucket.key),
      registrableDomain: bucket.key.registrableDomain,
      subdomain: bucket.key.subdomain
    };
    groups.push({ key: groupKey, bucketId: bucket.bucketId, tabs: bucket.tabs });
  }
  groups.sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0));

  return { groups, singles };
}
