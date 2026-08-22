import { browser, type Browser } from 'wxt/browser';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';

/**
 * tabs 平台适配层：chrome API 映射与查询。
 *
 * platform 层是唯一允许触碰 browser.* 的层；core/stores 只消费 TabRecord。
 * 事件 → 快照的调度在 platform/sync/TabSyncService，本模块不持有事件逻辑。
 */

// Browser 是 namespace（@wxt-dev/browser 生成类型），需点访问其类型成员。
type ChromeTab = Browser.tabs.Tab;

/** chrome.tabs.Tab → TabRecord 领域映射。 */
export function mapTab(tab: ChromeTab): TabRecord {
  const splitViewId = (tab as unknown as { splitViewId?: number }).splitViewId;
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    index: tab.index,
    active: tab.active,
    pinned: tab.pinned,
    incognito: tab.incognito,
    url: tab.url,
    pendingUrl: tab.pendingUrl,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    status: tab.status,
    muted: tab.mutedInfo?.muted,
    groupId: tab.groupId ?? NO_GROUP,
    splitViewId
  };
}

/** 查询当前窗口全部标签并按 index 排序。 */
export async function queryCurrentWindowTabs(): Promise<TabRecord[]> {
  const queriedTabs = await browser.tabs.query({ currentWindow: true });
  return queriedTabs.map(mapTab).sort((a, b) => a.index - b.index);
}

/** 切换标签。 */
export async function activateTab(tabId: number): Promise<void> {
  await browser.tabs.update(tabId, { active: true });
}
