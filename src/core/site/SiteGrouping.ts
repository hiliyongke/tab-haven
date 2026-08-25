import type { TabRecord } from '@/core/tab-types';
import type { SiteKey } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';
import { domainToUnicode } from '@/core/url/punycode';

/**
 * 站点聚合：把一组标签按归组键聚合为"站点组 + 独立标签"。
 *
 * 行为规格（PRD 附录 C-4 / FR-D3.1）：
 *  - 同注册域标签达到阈值（默认 2）成组，未达阈值归独立；
 *  - 排除集（用户手动移出的标签）永不参与聚合；
 *  - 子域自动展开：同一注册域下不同子域数 ≥ {@link AUTO_EXPAND_THRESHOLD} 时，
 *    自动按子域独立成组（子域即业务，避免 mail.qq.com 与 v.qq.com 强行合并）；
 *    否则折叠为注册域大组 + 子域亚组（少子域时信息密度优先）。
 *  - 组按组内首标签的位置排序。
 *
 * 算法让用户无需配置"分几级"：算法按子域密度自动判断。
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
  /**
   * 按子域再分的亚组；折叠模式（子域数 < 阈值）下非空时用于展示子分组；
   * 自动展开模式下恒为空。
   */
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

/**
 * 同一注册域下不同子域数达到该阈值时，自动按子域独立成组（不再折叠到大组）。
 * 用户无需配置：qq.com 这种 6+ 子域门户会自动展开；example.com 这种 2 子域保持折叠。
 */
export const AUTO_EXPAND_THRESHOLD = 3;

/** 单子域分组展示标签：裸域为注册域，否则 "子域.注册域"。 */
function subLabel(subdomain: string, registrableDomain: string): string {
  return subdomain ? `${subdomain}.${registrableDomain}` : registrableDomain;
}

interface RegBucket {
  registrableDomain: string;
  /** 空字符串 key 表示裸域（无子域）。 */
  subdomainToTabs: Map<string, TabRecord[]>;
}

export function aggregateBySite(
  tabs: readonly TabRecord[],
  options: AggregationOptions = {}
): SiteAggregation {
  const threshold = options.threshold ?? 2;
  const excluded = options.excludedTabIds ?? new Set<number>();

  // 第一遍：按注册域分桶，桶内按子域再分小桶（含裸域空串）。
  const regBuckets = new Map<string, RegBucket>();
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
    const bucket =
      regBuckets.get(key.value) ??
      ({ registrableDomain: key.value, subdomainToTabs: new Map<string, TabRecord[]>() } as RegBucket);
    const sub = key.subdomain;
    const list = bucket.subdomainToTabs.get(sub) ?? [];
    list.push(tab);
    bucket.subdomainToTabs.set(sub, list);
    regBuckets.set(key.value, bucket);
  }

  const groups: SiteGroup[] = [];
  for (const bucket of regBuckets.values()) {
    let totalTabs = 0;
    for (const subTabs of bucket.subdomainToTabs.values()) totalTabs += subTabs.length;
    if (totalTabs < threshold) {
      // 注册域桶总标签不足阈值，全部进 singles。
      for (const subTabs of bucket.subdomainToTabs.values()) singles.push(...subTabs);
      continue;
    }

    const subEntries = [...bucket.subdomainToTabs.entries()].sort(
      (a, b) => (a[1][0]?.index ?? 0) - (b[1][0]?.index ?? 0)
    );

    if (bucket.subdomainToTabs.size >= AUTO_EXPAND_THRESHOLD) {
      // 自动展开：每个子域独立成组（不折叠大组，避免多业务子域强行合并）。
      for (const [sub, subTabs] of subEntries) {
        if (subTabs.length < threshold) {
          singles.push(...subTabs);
          continue;
        }
        const value = sub
          ? `${sub}.${bucket.registrableDomain}`
          : bucket.registrableDomain;
        groups.push({
          key: {
            value,
            label: domainToUnicode(value),
            registrableDomain: bucket.registrableDomain,
            subdomain: sub
          },
          tabs: subTabs,
          subgroups: []
        });
      }
    } else {
      // 折叠：原注册域大组 + 子域亚组（少子域时信息密度优先）。
      const subgroups: SiteSubGroup[] =
        subEntries.length > 1
          ? subEntries.map(([sub, subTabs]) => ({
              subdomain: sub,
              label: domainToUnicode(subLabel(sub, bucket.registrableDomain)),
              tabs: subTabs
            }))
          : [];
      // 注：tabs 按子域块排序（块内按 index），非全局 index——组内展示与子分组一致，属有意取舍。
      const flat = subEntries.flatMap(([, subTabs]) => subTabs);
      // 单子域：标题用子域多级标签（cloud.tencent.com），避免裸注册域丢失去子域信息；
      // 多子域：父级用注册域根（tencent.com）作为集合标题，子域在组内折叠展示。
      const rootSub = subEntries[0]?.[0] ?? '';
      const title =
        subEntries.length === 1
          ? subLabel(rootSub, bucket.registrableDomain)
          : bucket.registrableDomain;
      groups.push({
        key: {
          value: title,
          label: domainToUnicode(title),
          registrableDomain: bucket.registrableDomain,
          subdomain: subEntries.length === 1 ? rootSub : ''
        },
        tabs: flat,
        subgroups
      });
    }
  }
  groups.sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0));

  return { groups, singles };
}