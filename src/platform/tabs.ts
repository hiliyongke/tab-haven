import { browser, type Browser } from 'wxt/browser';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';

/**
 * tabs 平台适配层：chrome API 映射 + 事件聚合器（40ms 防抖）。
 *
 * platform 层是唯一允许触碰 browser.* 的层；core/stores 只消费 TabRecord。
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

/** 查询当前窗口全部标签并按 index 排序（基线语义）。 */
export async function queryCurrentWindowTabs(): Promise<TabRecord[]> {
  const queriedTabs = await browser.tabs.query({ currentWindow: true });
  return queriedTabs.map(mapTab).sort((a, b) => a.index - b.index);
}

/** 切换标签。 */
export async function activateTab(tabId: number): Promise<void> {
  await browser.tabs.update(tabId, { active: true });
}

export type RefreshListener = () => void;

/**
 * 标签事件聚合器：全部 tabs/tabGroups 事件 → 40ms 防抖 → 回调。
 * 基线已验证的防抖值，避免事件风暴下的高频重查询。
 * 返回清理函数（清除未决定时器）；监听器随扩展页面生命周期存续。
 */
export function startTabEventAggregator(onRefresh: RefreshListener): () => void {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(onRefresh, 40);
  };

  browser.tabs.onCreated.addListener(scheduleRefresh);
  browser.tabs.onRemoved.addListener(scheduleRefresh);
  browser.tabs.onUpdated.addListener(scheduleRefresh);
  browser.tabs.onActivated.addListener(scheduleRefresh);
  browser.tabs.onMoved.addListener(scheduleRefresh);
  browser.tabs.onAttached.addListener(scheduleRefresh);
  browser.tabs.onDetached.addListener(scheduleRefresh);
  browser.tabs.onReplaced.addListener(scheduleRefresh);
  if (browser.tabGroups) {
    browser.tabGroups.onCreated.addListener(scheduleRefresh);
    browser.tabGroups.onUpdated.addListener(scheduleRefresh);
    browser.tabGroups.onMoved.addListener(scheduleRefresh);
    browser.tabGroups.onRemoved.addListener(scheduleRefresh);
  }

  return () => {
    clearTimeout(refreshTimer);
  };
}
