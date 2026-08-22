import type { TabRecord } from '@/core/tab-types';

/**
 * URL 判定纯函数族（从 Tabstead background.js 移植，语义不变）。
 * 供 background 复用引擎与 UI 侧共用。
 */

/** 优先取导航中 URL，其次取已提交 URL（导航未完成也能比较）。 */
export function comparableUrl(tab: Pick<TabRecord, 'pendingUrl' | 'url'>): string {
  return tab.pendingUrl || tab.url || '';
}

/** 仅 http/https 可参与复用（chrome:// 等从不复用）。 */
export function isReusableUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 空白起始页：等真正导航后再判定。 */
export function isBlankStartUrl(url: string): boolean {
  return (
    !url ||
    url === 'about:blank' ||
    url === 'chrome://newtab/' ||
    url === 'chrome://new-tab-page/'
  );
}
