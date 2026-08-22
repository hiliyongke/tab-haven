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

// wxt 生成的 browser 类型对 tabGroups 的 create/remove 以及 update 的
// title/color 属性覆盖不全，这里做一次性、受控的类型桥接（集中声明，避免散落的 never 绕过）。
interface TabGroupMutableProps {
  title?: string;
  color?: string;
  collapsed?: boolean;
}
const tabGroups = browser.tabGroups as unknown as {
  create: (options: object) => Promise<{ id: number }>;
  remove: (groupId: number) => Promise<void>;
  update: (groupId: number, updateProperties: TabGroupMutableProps) => Promise<unknown>;
};

/** chrome.tabs.Tab → TabRecord 领域映射。 */
export function mapTab(tab: ChromeTab): TabRecord {
  // chrome 140+ 会给每条标签返回 splitViewId，未分屏时为 0（非 undefined）。
  // 仅正整数表示真实拆分视图，其余归一化为 undefined。
  const rawSplit = (tab as unknown as { splitViewId?: unknown }).splitViewId;
  const splitViewId = typeof rawSplit === 'number' && rawSplit > 0 ? rawSplit : undefined;
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
    autoDiscardable: tab.autoDiscardable,
    openerTabId: tab.openerTabId,
    attention: (tab as unknown as { attention?: boolean }).attention,
    language: (tab as unknown as { language?: string }).language
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

/** 关闭标签并返回实际成功的标签 id，供撤销和批量反馈使用。 */
export async function closeTabs(tabIds: readonly number[]): Promise<number[]> {
  const closedIds: number[] = [];
  for (const tabId of tabIds) {
    try {
      await browser.tabs.remove(tabId);
      closedIds.push(tabId);
    } catch {
      // 系统标签或已关闭标签无法移除，继续处理其余标签
    }
  }
  return closedIds;
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

/** 在当前窗口新建标签，返回领域记录。 */
export async function createNewTab(windowId: number | undefined): Promise<TabRecord> {
  const properties: { active: boolean; windowId?: number } = { active: true };
  if (windowId !== undefined) properties.windowId = windowId;
  const tab = await browser.tabs.create(properties);
  return mapTab(tab);
}

/** 更新标签 URL（固定条目打开等场景）。 */
export async function updateTabUrl(tabId: number, url: string): Promise<void> {
  await browser.tabs.update(tabId, { url });
}

/**
 * 将标签移动到窗口内的指定扁平索引（拖拽重排写回原生顺序用）。
 * index 为目标窗口内位置（0 起、连续）；跨固定/未固定边界由 Chrome 处理。
 */
export async function moveTab(tabId: number, index: number): Promise<void> {
  await browser.tabs.move(tabId, { index });
}

/**
 * 依据“侧边栏展示顺序”计算把 source 放到 target 之前/之后时应去的原生索引。
 * 通过重建扁平有序列表（排除 source 后按 index 排序，再在目标位插入）得到目标位置，
 * 该位置即可作为 chrome.tabs.move 的 index（窗口内标签索引连续 0..n-1）。
 */
export function computeReorderIndex(params: {
  tabs: readonly TabRecord[];
  sourceId: number;
  targetId: number;
  placeAfter: boolean;
}): number {
  const { tabs, sourceId, targetId, placeAfter } = params;
  const ordered = [...tabs]
    .filter((tab) => tab.id !== sourceId)
    .sort((a, b) => a.index - b.index);
  const targetPos = ordered.findIndex((tab) => tab.id === targetId);
  if (targetPos === -1) return -1;
  const source = tabs.find((tab) => tab.id === sourceId);
  if (!source) return -1;
  ordered.splice(placeAfter ? targetPos + 1 : targetPos, 0, source);
  return ordered.findIndex((tab) => tab.id === sourceId);
}

/** 冻结（卸载）标签并返回是否成功。休眠后的标签点击会重新加载。 */
export async function discardTab(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.discard(tabId);
    return true;
  } catch {
    // 活跃标签、已丢弃标签或系统页面无法丢弃
    return false;
  }
}

/** 复制标签（对标浏览器原生右键「复制标签页」）。 */
export async function duplicateTab(tabId: number): Promise<void> {
  try {
    await browser.tabs.duplicate(tabId);
  } catch {
    // 某些特殊页面无法复制，静默忽略
  }
}

/**
 * 将若干标签归入一个原生组（固定文件夹 → 原生组桥接用）。
 * 返回新建组的 id。
 */
export async function groupTabs(tabIds: readonly number[]): Promise<number | undefined> {
  if (tabIds.length === 0) return undefined;
  return browser.tabs.group({ tabIds: [...tabIds] as [number, ...number[]] });
}

/** 设置原生组的标题与颜色。 */
export async function updateGroupMeta(groupId: number, title: string, color?: string): Promise<void> {
  await tabGroups.update(groupId, color ? { title, color } : { title });
}

/** 截取当前窗口激活标签的可见区域为 dataURL（标签预览，P1④）。跳过隐身由调用方判断。 */
export async function captureVisibleTab(windowId: number): Promise<string | undefined> {
  try {
    return await browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
  } catch {
    return undefined;
  }
}

/** 新建命名原生组，返回组 id；可附带初始成员。 */
export async function createGroup(
  title: string,
  color?: string,
  tabIds?: readonly number[]
): Promise<number | undefined> {
  const created = await tabGroups.create({});
  if (!created?.id) return undefined;
  await tabGroups.update(created.id, color ? { title, color } : { title });
  if (tabIds && tabIds.length > 0) {
    await browser.tabs.group({ tabIds: [...tabIds] as [number, ...number[]], groupId: created.id });
  }
  return created.id;
}

/** 重命名原生组（P1⑤）。 */
export async function renameGroup(groupId: number, title: string): Promise<void> {
  await browser.tabGroups.update(groupId, { title });
}

/** 改变原生组颜色（P1⑤）。 */
export async function recolorGroup(groupId: number, color: string): Promise<void> {
  await tabGroups.update(groupId, { color });
}

/** 删除原生组，组内标签随之解散（不关闭）。 */
export async function removeGroup(groupId: number): Promise<void> {
  await tabGroups.remove(groupId);
}

/** 移动原生组到指定索引（组排序，P1⑤）。 */
export async function moveGroup(groupId: number, index: number): Promise<void> {
  await browser.tabGroups.move(groupId, { index });
}

/** 激活标签后退（Chrome 114+，P2⑦）。 */
export async function goBack(tabId: number): Promise<void> {
  try {
    await browser.tabs.goBack(tabId);
  } catch {
    // 无历史记录的标签无法后退，静默忽略
  }
}

/** 激活标签前进（Chrome 114+，P2⑦）。 */
export async function goForward(tabId: number): Promise<void> {
  try {
    await browser.tabs.goForward(tabId);
  } catch {
    // 无历史记录的标签无法前进，静默忽略
  }
}

/** 高亮多个标签（与浏览器 multi-select 同步，P2⑧）。 */
export async function highlightTabs(tabIds: readonly number[]): Promise<void> {
  if (tabIds.length === 0) return;
  try {
    await browser.tabs.highlight({ tabs: [...tabIds] });
  } catch {
    // 某些标签无法高亮，静默忽略
  }
}

/** 检测标签页面语言，返回 BCP-47 代码（P3⑩）。不支持时返回 "und"。 */
export async function detectLanguage(tabId: number): Promise<string> {
  try {
    return await browser.tabs.detectLanguage(tabId);
  } catch {
    return 'und';
  }
}
