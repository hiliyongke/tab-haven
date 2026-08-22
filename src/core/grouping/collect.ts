import type { TabRecord } from '@/core/tab-types';
import { siteIdentity, type SiteIdentity } from '@/core/grouping/site';

/**
 * 网站聚合（从 Tabstead collectWebsiteGroups 移植，语义不变）。
 * 纯函数：输入未分组标签，输出网站分组与独立标签。
 */

export interface WebsiteGroup extends SiteIdentity {
  tabs: TabRecord[];
}

export interface WebsiteGrouping {
  /** 同站点 ≥ 阈值（默认 2）的聚合组，按组内首标签 index 排序。 */
  websiteGroups: WebsiteGroup[];
  /** 未达阈值或不可识别的独立标签。 */
  standaloneTabs: TabRecord[];
}

export function collectWebsiteGroups(
  ungroupedTabs: readonly TabRecord[],
  manualStandaloneTabIds: ReadonlySet<number> = new Set(),
  threshold = 2
): WebsiteGrouping {
  const buckets = new Map<string, WebsiteGroup>();
  const standaloneTabs: TabRecord[] = [];

  for (const tab of ungroupedTabs) {
    // 用户手动移出的标签永不参与聚合（基线语义）。
    if (manualStandaloneTabIds.has(tab.id)) {
      standaloneTabs.push(tab);
      continue;
    }
    const site = tab.url ? siteIdentity(tab.url) : null;
    if (!site) {
      standaloneTabs.push(tab);
      continue;
    }
    const bucket = buckets.get(site.key) || { ...site, tabs: [] };
    bucket.tabs.push(tab);
    buckets.set(site.key, bucket);
  }

  const websiteGroups: WebsiteGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.tabs.length >= threshold) {
      websiteGroups.push(bucket);
    } else {
      standaloneTabs.push(...bucket.tabs);
    }
  }
  websiteGroups.sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0));

  return { websiteGroups, standaloneTabs };
}
