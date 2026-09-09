import type { TabRecord } from '@/core/tab-types';
import type { SiteKey } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';
import { domainToUnicode } from '@/core/url/punycode';

/**
 * 站点聚合：把一组标签按归组键聚合为"站点组 + 独立标签"。
 *
 * 同站点聚合规则（永远平铺，一子域一组）：
 *  - 同子域站点标签达到阈值（默认 2）成组，未达阈值归独立；
 *  - 排除集（用户手动移出的标签）永不参与聚合；
 *  - 组按组内首标签的位置排序。
 *
 * 曾经存在「少子域折叠为注册域父组 + 子域亚组」的嵌套模式，因层级在侧边栏里
 * 认知成本高、且与原生组混排时观感不一致（用户反馈嵌套困惑）而移除：
 * 组 = 子域站点，层级永远只有一级。
 */

export interface SiteSubGroup {
  /** 子域部分（不含 www；裸域为空串）。 */
  subdomain: string;
  /** 展示标签（子域.注册域 或裸注册域）。 */
  label: string;
  tabs: TabRecord[];
}

interface SiteGroup {
  key: SiteKey;
  /** 组内全部标签（兼容字段）。 */
  tabs: TabRecord[];
  /** 折叠模式已移除，恒为空；保留字段以兼容归并（buildSitePlan）与渲染路径。 */
  subgroups: SiteSubGroup[];
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
}

/** 分组展示标签：裸域为注册域，否则 "子域.注册域"。 */
export function subLabel(subdomain: string, registrableDomain: string): string {
  return subdomain ? `${subdomain}.${registrableDomain}` : registrableDomain;
}

export function aggregateBySite(
  tabs: readonly TabRecord[],
  options: AggregationOptions = {}
): SiteAggregation {
  const threshold = options.threshold ?? 2;
  const excluded = options.excludedTabIds ?? new Set<number>();

  // 按「子域站点」直接分桶：桶 = (归组键, 子域)。一子域一组，无注册域折叠父组。
  const buckets = new Map<string, { key: SiteKey; tabs: TabRecord[] }>();
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
    // 桶键含 value（本地/IP 站点的 value 带端口）：localhost:3000 与
    // localhost:8080 不并桶；同站点归并的比较口径（registrableDomain）不变。
    const bucketId = `${key.value}${key.subdomain}`;
    let bucket = buckets.get(bucketId);
    if (!bucket) {
      bucket = { key, tabs: [] };
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
    const { key } = bucket;
    // 子域非空：组键/标题用「子域.注册域」（cloud.tencent.com），不丢子域信息；
    // 空子域（裸域 / 本地 / IP / 托管后缀）：沿用解析器原始键（保留端口）。
    const value = subLabel(key.subdomain, key.registrableDomain);
    const groupKey: SiteKey =
      key.subdomain === ''
        ? key
        : {
            value,
            label: domainToUnicode(value),
            registrableDomain: key.registrableDomain,
            subdomain: key.subdomain
          };
    groups.push({ key: groupKey, tabs: bucket.tabs, subgroups: [] });
  }
  groups.sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0));

  return { groups, singles };
}
