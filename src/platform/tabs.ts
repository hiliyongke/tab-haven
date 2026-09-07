import { browser, type Browser } from 'wxt/browser';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { logDegraded } from '@/platform/diagnostics';

/**
 * tabs 平台适配层：chrome API 映射与查询。
 *
 * platform 层是唯一允许触碰 browser.* 的层；core/stores 只消费 TabRecord。
 * 事件 → 快照的调度在 platform/sync/TabSyncService，本模块不持有事件逻辑。
 */

// Browser 是 namespace（@wxt-dev/browser 生成类型），需点访问其类型成员。
type ChromeTab = Browser.tabs.Tab;
type ChromeTabGroup = Browser.tabGroups.TabGroup;

// wxt 生成的 browser 类型对 tabGroups 的 create 以及 update 的
// title/color 属性覆盖不全，这里做一次性、受控的类型桥接（集中声明，避免散落的 never 绕过）。
// 注：chrome.tabGroups 没有 remove API（公开方法仅 get/query/update/move），
// 解散组的标准做法是 tabs.ungroup 成员，见下方 removeGroup。
interface TabGroupMutableProps {
  title?: string;
  color?: string;
  collapsed?: boolean;
}
const tabGroups = browser.tabGroups as unknown as {
  create: (options: object) => Promise<{ id: number }>;
  update: (groupId: number, updateProperties: TabGroupMutableProps) => Promise<unknown>;
  /** 用于判定组是否仍存在（区分「已解散」与「解散失败」），见 removeGroup。 */
  get: (groupId: number) => Promise<unknown>;
  move: (groupId: number, options: { index: number }) => Promise<unknown>;
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

export async function activateTab(tabId: number): Promise<void> {
  try {
    await browser.tabs.update(tabId, { active: true });
  } catch (error) {
    logDegraded('tabs', '激活标签失败', error);
    // 标签可能已关闭；激活失败静默忽略（best-effort UI 操作）。
  }
}

/** 关闭标签并返回实际成功的标签 id，供撤销和批量反馈使用。 */
export async function closeTabs(tabIds: readonly number[]): Promise<number[]> {
  const closedIds: number[] = [];
  for (const tabId of tabIds) {
    try {
      await browser.tabs.remove(tabId);
      closedIds.push(tabId);
    } catch (error) {
      logDegraded('tabs', 'removeTabs 部分标签删除失败', error);
      // 系统标签或已关闭标签无法移除，继续处理其余标签
    }
  }
  return closedIds;
}

export async function toggleMute(tabId: number, currentlyMuted: boolean): Promise<void> {
  try {
    await browser.tabs.update(tabId, { muted: !currentlyMuted });
  } catch (error) {
    logDegraded('tabs', '切换静音失败', error);
    // 标签可能已关闭
  }
}

export async function togglePinned(tabId: number, currentlyPinned: boolean): Promise<void> {
  try {
    await browser.tabs.update(tabId, { pinned: !currentlyPinned });
  } catch (error) {
    logDegraded('tabs', '切换固定失败', error);
    // 标签可能已关闭
  }
}

export async function setGroupCollapsed(groupId: number, collapsed: boolean): Promise<void> {
  try {
    await browser.tabGroups.update(groupId, { collapsed });
  } catch (error) {
    logDegraded('tabs', '切换固定失败', error);
    // 标签组可能已解散
  }
}

/**
 * 在当前窗口新建标签，返回领域记录。
 * position：end 窗口末尾（默认）/ after-active 当前激活标签之后。
 */
export async function createNewTab(
  windowId: number | undefined,
  position: 'end' | 'after-active' = 'end'
): Promise<TabRecord> {
  const properties: { active: boolean; windowId?: number; index?: number } = { active: true };
  if (windowId !== undefined) properties.windowId = windowId;
  if (position === 'after-active' && windowId !== undefined) {
    const [active] = await browser.tabs.query({ windowId, active: true });
    if (active?.index !== undefined) properties.index = active.index + 1;
  }
  const tab = await browser.tabs.create(properties);
  return mapTab(tab);
}

/** 更新标签 URL（固定条目打开等场景）。返回是否成功（标签已关闭时为 false）。 */
export async function updateTabUrl(tabId: number, url: string): Promise<boolean> {
  try {
    await browser.tabs.update(tabId, { url });
    return true;
  } catch (error) {
    logDegraded('tabs', `更新标签 ${tabId} 的 URL 失败`, error);
    return false;
  }
}

/**
 * 将标签移动到窗口内的指定扁平索引（拖拽重排写回原生顺序用）。
 * index 为目标窗口内位置（0 起、连续）；跨固定/未固定边界由 Chrome 处理。
 * 返回是否成功（拖拽期间标签被关闭时失败，属正常竞态，不视为错误）。
 */
export async function moveTab(tabId: number, index: number): Promise<boolean> {
  try {
    await browser.tabs.move(tabId, { index });
    return true;
  } catch (error) {
    logDegraded('tabs', `移动标签 ${tabId} 到索引 ${index} 失败`, error);
    return false;
  }
}

/**
 * 批量移动标签到窗口内指定扁平索引（拖拽整个分区/站点组时用）。
 *
 * Chrome 的 tabs.move 接受 id 数组，按传入顺序原子地落到 index 起的连续位置，
 * 组内相对顺序得以保持——这正是「整组搬家」所需的语义，无需逐个 move 再补偿位移。
 * 返回是否成功（拖拽期间标签被关闭时失败，属正常竞态，不视为错误）。
 */
export async function moveTabs(tabIds: readonly number[], index: number): Promise<boolean> {
  if (tabIds.length === 0) return false;
  try {
    await browser.tabs.move([...tabIds], { index });
    return true;
  } catch (error) {
    logDegraded('tabs', `移动 ${tabIds.length} 个标签到索引 ${index} 失败`, error);
    return false;
  }
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
  const ordered = [...tabs].filter((tab) => tab.id !== sourceId).sort((a, b) => a.index - b.index);
  const targetPos = ordered.findIndex((tab) => tab.id === targetId);
  if (targetPos === -1) return -1;
  const source = tabs.find((tab) => tab.id === sourceId);
  if (!source) return -1;
  ordered.splice(placeAfter ? targetPos + 1 : targetPos, 0, source);
  return ordered.findIndex((tab) => tab.id === sourceId);
}

/**
 * 计算把 source 整组搬到 target 组之前/之后时，组内首个标签应去的原生索引。
 *
 * 站点组 / 语言组这类「虚拟分区」没有原生 groupId，无法用 tabGroups.move；
 * 但它们的展示顺序由组内标签的 index 决定（见 SiteGrouping 的 groups.sort），
 * 因此把整组标签连续地落到目标组的前面或后面，即可真正改变分区顺序并持久化
 * 到浏览器——不需要额外的顺序存储，也不会与自动归类冲突。
 *
 * 算法与 computeReorderIndex 同构：先剔除整组 source 消除自身占位，
 * 再在剩余有序列表里取 target 组的首/末位置作为落点。
 * 返回 -1 表示目标组已不存在（拖拽期间被关闭/解散），调用方应静默放弃。
 */
export function computeGroupMoveIndex(params: {
  tabs: readonly TabRecord[];
  sourceTabIds: readonly number[];
  targetTabIds: readonly number[];
  placeAfter: boolean;
}): number {
  const { tabs, sourceTabIds, targetTabIds, placeAfter } = params;
  const sourceIds = new Set(sourceTabIds);
  if (sourceIds.size === 0) return -1;
  const targetIds = new Set(targetTabIds);
  if (targetIds.size === 0) return -1;

  const ordered = [...tabs]
    .filter((tab) => !sourceIds.has(tab.id))
    .sort((a, b) => a.index - b.index);
  let first: number | undefined;
  let last: number | undefined;
  for (let i = 0; i < ordered.length; i += 1) {
    if (targetIds.has(ordered[i]!.id)) {
      if (first === undefined) first = i;
      last = i;
    }
  }
  if (first === undefined || last === undefined) return -1;
  return placeAfter ? last + 1 : first;
}

/** 冻结（卸载）标签并返回是否成功。休眠后的标签点击会重新加载。 */
export async function discardTab(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.discard(tabId);
    return true;
  } catch (error) {
    logDegraded('tabs', '休眠标签失败', error);
    // 活跃标签、已丢弃标签或系统页面无法丢弃
    return false;
  }
}

/** 复制标签（对标浏览器原生右键「复制标签页」）。 */
export async function duplicateTab(tabId: number): Promise<void> {
  try {
    await browser.tabs.duplicate(tabId);
  } catch (error) {
    logDegraded('tabs', '复制标签失败', error);
    // 某些特殊页面无法复制，静默忽略
  }
}

/**
 * 将若干标签归入一个原生组（固定文件夹 → 原生组桥接用）。
 * 返回新建组的 id。
 */
export async function groupTabs(tabIds: readonly number[]): Promise<number | undefined> {
  if (tabIds.length === 0) return undefined;
  try {
    return await browser.tabs.group({ tabIds: [...tabIds] as [number, ...number[]] });
  } catch (error) {
    logDegraded('tabs', '创建原生标签组失败', error);
    return undefined;
  }
}

/** 设置原生组的标题与颜色。组可能已解散，失败不影响主流程。 */
export async function updateGroupMeta(
  groupId: number,
  title: string,
  color?: string
): Promise<void> {
  try {
    await tabGroups.update(groupId, color ? { title, color } : { title });
  } catch (error) {
    // 组在查询与写入之间被解散是常见竞态，降级记录即可。
    logDegraded('tabs', `更新分组 ${groupId} 的标题/颜色失败`, error);
  }
}

/** 重命名原生组。 */
export async function renameGroup(groupId: number, title: string): Promise<void> {
  try {
    await browser.tabGroups.update(groupId, { title });
  } catch (error) {
    logDegraded('tabs', '重命名分组失败', error);
    // 标签组可能已解散
  }
}

/** 改变原生组颜色。 */
export async function recolorGroup(groupId: number, color: string): Promise<void> {
  try {
    await tabGroups.update(groupId, { color });
  } catch (error) {
    logDegraded('tabs', '修改分组颜色失败', error);
    // 标签组可能已解散
  }
}

/** 原生组是否仍存在（用于区分「已解散」与「解散失败」）。 */
async function groupExists(groupId: number): Promise<boolean> {
  try {
    await browser.tabGroups.get(groupId);
    return true;
  } catch {
    return false;
  }
}

/**
 * 解散原生组：把组内全部标签移出分组（标签保留不关闭，空组由浏览器自动回收）。
 * chrome.tabGroups 无 remove API，ungroup 是唯一标准做法。
 *
 * 返回解散结果，让调用方能区分三种情形：
 * 导致 AutoGroupSync 把「查询失败」误判为「解散失败」并无限重试）：
 *  - 'removed'：组存在且已解散（含组内无成员的自然空组）；
 *  - 'missing'：组已不存在（用户手动解散）——调用方应清理记录，不应重试；
 *  - 'failed'：真实失败（查询或 ungroup 报错）——可重试。
 */
export async function removeGroup(groupId: number): Promise<'removed' | 'missing' | 'failed'> {
  let members: ChromeTab[];
  try {
    members = await browser.tabs.query({ groupId });
  } catch (error) {
    logDegraded('tabs', `查询分组 ${groupId} 成员失败`, error);
    return 'failed';
  }

  try {
    if (await groupExists(groupId)) {
      const tabIds = members.map((tab) => tab.id).filter((id): id is number => id !== undefined);
      if (tabIds.length > 0) await browser.tabs.ungroup(tabIds as [number, ...number[]]);
      return 'removed';
    }
  } catch (error) {
    logDegraded('tabs', `解散分组 ${groupId} 失败`, error);
    return 'failed';
  }

  // 组已不存在：视为目标已达成，调用方应清理记录而非重试。
  return 'missing';
}

/** 移动原生组到指定索引（组排序，P1⑤）。 */
export async function moveGroup(groupId: number, index: number): Promise<void> {
  try {
    await browser.tabGroups.move(groupId, { index });
  } catch (error) {
    logDegraded('tabs', '移动分组失败', error);
    // 标签组可能已解散
  }
}

/** 检测标签页面语言，返回 BCP-47 代码。不支持时返回 "und"。 */
export async function detectLanguage(tabId: number): Promise<string> {
  try {
    return await browser.tabs.detectLanguage(tabId);
  } catch (error) {
    logDegraded('tabs', '检测标签语言失败', error);
    return 'und';
  }
}

/** 重新加载（唤醒）一组标签，返回成功的标签 id（撤销「自动休眠」用）。 */
export async function reloadTabs(tabIds: readonly number[]): Promise<number[]> {
  const reloaded: number[] = [];
  for (const tabId of tabIds) {
    try {
      await browser.tabs.reload(tabId);
      reloaded.push(tabId);
    } catch (error) {
      logDegraded('tabs', '重载标签失败', error);
      // 已关闭或无法重载的标签跳过
    }
  }
  return reloaded;
}

/** 激活任意窗口中的标签：必要时先聚焦其所在窗口（跨窗口搜索切换用）。 */
export async function activateTabAcrossWindows(tab: {
  id: number;
  windowId: number;
}): Promise<void> {
  try {
    await browser.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    logDegraded('tabs', '跨窗口激活：聚焦窗口失败', error);
    // 窗口可能已关闭，忽略
  }
  await activateTab(tab.id);
}

/** 查询全部窗口的普通标签（跨窗口搜索数据源）。 */
export async function queryAllWindowTabs(): Promise<TabRecord[]> {
  const queriedTabs = await browser.tabs.query({ windowType: 'normal' });
  return queriedTabs.map(mapTab);
}

/**
 * 批量新建标签并导航（「打开文件夹全部条目」/「恢复快照」等显式打开场景用）。
 * 每个 URL 先申请复用豁免再创建——显式打开不应被 uniqueUrlTabs 复用引擎合并；
 * 返回实际创建成功的标签数。
 */
export async function createTabsWithUrls(
  urls: readonly string[],
  windowId?: number,
  active = false
): Promise<number> {
  let target = windowId;
  if (target === undefined) {
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    target = win?.id;
  }
  let created = 0;
  for (const url of urls) {
    try {
      if (target !== undefined) await grantReuseAllowance(target, url);
      await browser.tabs.create({
        url,
        active,
        ...(target !== undefined ? { windowId: target } : {})
      });
      created += 1;
    } catch (error) {
      logDegraded('tabs', '批量新建标签：单条创建失败', error);
      // 无效 URL 跳过，其余继续
    }
  }
  return created;
}
