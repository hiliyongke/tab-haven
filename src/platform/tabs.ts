import { browser, type Browser } from 'wxt/browser';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';

/**
 * tabs 平台适配层：chrome API 映射与查询。
 *
 * platform 层是唯一允许触碰 browser.* 的层；core/stores 只消费 TabRecord。
 * 事件 → 快照的调度在 platform/sync/TabSyncService，本模块不持有事件逻辑。
 */

// Browser 是 namespace（@wxt-dev/browser 生成类型），需点访问其类型成员。
type ChromeTab = Browser.tabs.Tab;
type ChromeTabGroup = Browser.tabGroups.TabGroup;

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
    audible: tab.audible,
    groupId: tab.groupId ?? NO_GROUP,
    splitViewId
  };
}

/** chrome.tabGroups.TabGroup → TabGroupRecord 映射。 */
export function mapTabGroup(group: ChromeTabGroup): TabGroupRecord {
  return {
    id: group.id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed
  };
}

/** 查询当前窗口全部标签并按 index 排序。 */
export async function queryCurrentWindowTabs(): Promise<TabRecord[]> {
  const queriedTabs = await browser.tabs.query({ currentWindow: true });
  return queriedTabs.map(mapTab).sort((a, b) => a.index - b.index);
}

/** 查询当前窗口全部原生标签组。 */
export async function queryCurrentWindowGroups(): Promise<TabGroupRecord[]> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const windowId = tabs[0]?.windowId;
  if (windowId === undefined) return [];
  const groups = await browser.tabGroups.query({ windowId });
  return groups.map(mapTabGroup);
}

/** 切换标签。 */
export async function activateTab(tabId: number): Promise<void> {
  await browser.tabs.update(tabId, { active: true });
}

/** 关闭标签（撤销联动在调用方，本层只做原子操作）。 */
export async function closeTabs(tabIds: readonly number[]): Promise<void> {
  await browser.tabs.remove([...tabIds]);
}

/** 切换静音。 */
export async function toggleMute(tabId: number, currentlyMuted: boolean): Promise<void> {
  await browser.tabs.update(tabId, { muted: !currentlyMuted });
}

/** 切换固定状态。 */
export async function togglePinned(tabId: number, currentlyPinned: boolean): Promise<void> {
  await browser.tabs.update(tabId, { pinned: !currentlyPinned });
}

/** 折叠/展开原生组。 */
export async function setGroupCollapsed(groupId: number, collapsed: boolean): Promise<void> {
  await browser.tabGroups.update(groupId, { collapsed });
}

/** 在原生组内新建标签（新标签自动入组）。 */
export async function createTabInGroup(groupId: number, windowId: number): Promise<void> {
  const tab = await browser.tabs.create({ windowId, active: true });
  await browser.tabs.group({ tabIds: [tab.id ?? -1], groupId });
}

/** 在当前窗口新建标签。 */
export async function createNewTab(windowId: number | undefined): Promise<void> {
  const properties: { active: boolean; windowId?: number } = { active: true };
  if (windowId !== undefined) properties.windowId = windowId;
  await browser.tabs.create(properties);
}
