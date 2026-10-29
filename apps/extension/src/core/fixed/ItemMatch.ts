import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 固定条目 URL 是否命中标签——固定空间「条目 ↔ 标签」判定的唯一口径。
 * 优先用 web 比较键；比较键只对 http(s) 有定义，chrome:// 等内部页退回原样字符串比较。
 */
export function itemUrlMatchesTab(itemUrl: string | undefined, tab: TabRecord): boolean {
  if (itemUrl === undefined) return false;
  const itemKey = webComparisonKey(itemUrl, undefined);
  if (itemKey !== null) return webComparisonKey(tab.url, tab.pendingUrl) === itemKey;
  return tab.url === itemUrl;
}
