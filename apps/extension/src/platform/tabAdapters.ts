import { type Browser } from 'wxt/browser';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';

// Browser 是 namespace（@wxt-dev/browser 生成类型），需点访问其类型成员。
export type ChromeTab = Browser.tabs.Tab;
type ChromeTabGroup = Browser.tabGroups.TabGroup;

/**
 * Chrome 在 tabs.Tab 上返回的附加字段：wxt 生成类型未收录 attention / language；
 * splitViewId 虽已收录，但按 unknown 读取以便统一做运行时收窄。字段全可选，Tab 可直接赋给本形状。
 */
interface ChromeTabExtras {
  /** 分屏视图 id（Chrome 140+）；未分屏时为 0，不是 undefined。 */
  splitViewId?: unknown;
  attention?: boolean;
  language?: string;
}

const extrasOf = (tab: ChromeTab): ChromeTabExtras => tab;

/** chrome.tabs.Tab → TabRecord 领域映射。 */
export function mapTab(tab: ChromeTab): TabRecord {
  const extras = extrasOf(tab);
  // 仅正整数表示真实拆分视图，chrome 未分屏时返回 0（非 undefined）。
  const splitViewId =
    typeof extras.splitViewId === 'number' && extras.splitViewId > 0
      ? extras.splitViewId
      : undefined;
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
    discarded: tab.discarded,
    muted: tab.mutedInfo?.muted,
    audible: tab.audible,
    groupId: tab.groupId ?? NO_GROUP,
    splitViewId,
    lastAccessed: tab.lastAccessed,
    // 与 lastAccessed 同源但命运不同：lastAccessed 会被 mergeSnapshotTabs 冻结成排序键，
    // lastActivatedAt 保持实时，供滞留预警 / keeper 判定等时间口径消费。
    lastActivatedAt: tab.lastAccessed,
    autoDiscardable: tab.autoDiscardable,
    openerTabId: tab.openerTabId,
    attention: extras.attention,
    language: extras.language
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

/** 收敛轮询次数与间隔（合计约 1.2s）。 */
export const GROUP_ASSIGN_MAX_ATTEMPTS = 6;
export const GROUP_ASSIGN_POLL_MS = 200;
