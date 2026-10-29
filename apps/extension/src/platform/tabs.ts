import { browser, type Browser } from 'wxt/browser';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '@/core/util/concurrency';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { logDegraded } from '@/platform/diagnostics';
import { isMissingGroupErrorMessage, tabGroups } from '@/platform/tabGroups';

/**
 * tabs 平台适配层：chrome API 映射与查询。
 * platform 层是唯一允许触碰 browser.* 的层；core/stores 只消费 TabRecord。
 * 事件 → 快照的调度在 platform/sync/TabSyncService，本模块不持有事件逻辑。
 */

// Browser 是 namespace（@wxt-dev/browser 生成类型），需点访问其类型成员。
type ChromeTab = Browser.tabs.Tab;
type ChromeTabGroup = Browser.tabGroups.TabGroup;

/** Chrome 在 tabs.Tab 上返回的、wxt 生成类型未收录的字段。断言集中到 extrasOf 这一处。 */
interface ChromeTabExtras {
  /** 分屏视图 id（Chrome 140+）；未分屏时为 0，不是 undefined。 */
  splitViewId?: unknown;
  attention?: boolean;
  language?: string;
}

const extrasOf = (tab: ChromeTab): ChromeTabExtras => tab as unknown as ChromeTabExtras;

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

/** 查询当前窗口全部标签并按 index 排序。 */
export async function queryCurrentWindowTabs(): Promise<TabRecord[]> {
  const queriedTabs = await browser.tabs.query({ currentWindow: true });
  return queriedTabs.map(mapTab).sort((a, b) => a.index - b.index);
}

/** 查询指定窗口的全部标签并按 index 排序。恢复类操作的目标窗口未必是侧边栏所在窗口。 */
export async function queryWindowTabs(windowId: number): Promise<TabRecord[]> {
  const queriedTabs = await browser.tabs.query({ windowId });
  return queriedTabs.map(mapTab).sort((a, b) => a.index - b.index);
}

/**
 * 查询当前窗口全部原生标签组。已知 windowId 时直接传入，避免内部再跑一次全量 tabs.query。
 * tabGroups 能力检测：不支持该 API 的浏览器每次查询必抛错，会让调用方进入永久失败退避。
 */
export async function queryWindowGroups(windowId?: number): Promise<TabGroupRecord[]> {
  if (!browser.tabGroups?.query) return [];
  let targetWindowId = windowId;
  if (targetWindowId === undefined) {
    const tabs = await browser.tabs.query({ currentWindow: true });
    targetWindowId = tabs[0]?.windowId;
  }
  if (targetWindowId === undefined) return [];
  const groups = await browser.tabGroups.query({ windowId: targetWindowId });
  return groups.map(mapTabGroup);
}

/** 读取单个标签。读取失败返回 undefined 而非抛错（这类调用点几乎都是「拿不到就跳过」的路径）。 */
export async function getTab(tabId: number): Promise<TabRecord | undefined> {
  try {
    return mapTab(await browser.tabs.get(tabId));
  } catch {
    return undefined;
  }
}

/** 激活标签。标签可能已关闭，失败只留痕不抛（best-effort UI 操作）。 */
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

/** 切换静音。翻转基准取浏览器实时值而非传入快照：传入值来自节流的渲染快照，可能已过期。 */
export async function toggleMute(tabId: number, currentlyMuted: boolean): Promise<void> {
  try {
    const live = await browser.tabs.get(tabId).catch(() => undefined);
    const base = live?.mutedInfo?.muted ?? currentlyMuted;
    await browser.tabs.update(tabId, { muted: !base });
  } catch (error) {
    logDegraded('tabs', '切换静音失败', error);
    // 标签可能已关闭
  }
}

/**
 * 切换标签固定状态，返回是否成功。平台层吞错 + UI 无条件提示成功会在实际失败时
 * 造成「提示已固定、实际没变」，故调用方据此给真实反馈。
 */
export async function togglePinned(tabId: number, currentlyPinned: boolean): Promise<boolean> {
  try {
    // 同 toggleMute：翻转基准取浏览器实时值，渲染快照可能过期。
    const live = await browser.tabs.get(tabId).catch(() => undefined);
    const base = live?.pinned ?? currentlyPinned;
    await browser.tabs.update(tabId, { pinned: !base });
    return true;
  } catch (error) {
    logDegraded('tabs', '切换固定失败', error);
    // 标签可能已关闭
    return false;
  }
}

/** 「确保固定」语义：置为目标固定状态。与 togglePinned 的翻转语义不同，以浏览器实时值为准，仅在不一致时才写。 */
export async function setPinned(tabId: number, pinned: boolean): Promise<boolean> {
  try {
    const live = await browser.tabs.get(tabId).catch(() => undefined);
    if (live && live.pinned === pinned) return true;
    await browser.tabs.update(tabId, { pinned });
    return true;
  } catch (error) {
    logDegraded('tabs', '设置固定状态失败', error);
    // 标签可能已关闭
    return false;
  }
}

/** 折叠 / 展开原生标签组。组在点击与写入之间被解散属预期内竞态，静默留痕即可。 */
export async function setGroupCollapsed(groupId: number, collapsed: boolean): Promise<void> {
  try {
    await tabGroups.update(groupId, { collapsed });
  } catch (error) {
    logDegraded('tabs', '切换分组折叠失败', error, { quiet: isMissingGroupError(error) });
  }
}

/** 新建空白标签。不指定 windowId —— 浏览器默认在当前窗口打开。 */
export async function createPlainNewTab(): Promise<TabRecord> {
  return mapTab(await browser.tabs.create({}));
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
 * 返回是否成功（拖拽期间标签被关闭时失败，属正常竞态）。
 */
export async function moveTab(tabId: number, index: number, windowId?: number): Promise<boolean> {
  try {
    // 带 windowId 时是跨窗口移动（新建标签落位到指定窗口），缺省为同窗口内移动。
    await browser.tabs.move(tabId, windowId === undefined ? { index } : { index, windowId });
    return true;
  } catch (error) {
    logDegraded('tabs', `移动标签 ${tabId} 到索引 ${index} 失败`, error);
    return false;
  }
}

/**
 * 批量移动标签到窗口内指定扁平索引（拖拽整个分区/站点组时用）。tabs.move 接受 id 数组，
 * 按传入顺序原子地落到 index 起的连续位置，组内相对顺序得以保持——正是「整组搬家」所需的语义。
 * 返回是否成功（拖拽期间标签被关闭时失败，属正常竞态）。
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

/** 依据侧边栏展示顺序计算把 source 放到 target 之前/之后时应去的原生索引（窗口内标签索引连续 0..n-1）。 */
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
 * 站点组 / 语言组这类「虚拟分区」没有原生 groupId，无法用 tabGroups.move；但它们的展示顺序
 * 由组内标签的 index 决定，因此把整组标签连续地落到目标组的前/后即可改变分区顺序并持久化。
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

/**
 * 把「标签序号」换算成 `chrome.tabGroups.move` 需要的**组序号**。
 *
 * 两者不是一回事：分组接口的 index 是窗口内标签组的排列位置（0..组数-1），
 * 而分区拖拽算出的是标签序号。窗口里只要存在未分组标签或其它组，数值就会错位，
 * 表现为「拖到 A 组后面，组却落到别处」。这里按「组的首个标签位置」还原组顺序，
 * 再以目标组为锚点插入。
 *
 * 返回 `undefined` 表示目标组已不存在（拖拽期间被解散），调用方应静默放弃；
 * 返回 `-1` 是接口约定的「放到窗口最后」，不是失败。
 */
export function computeNativeGroupMoveIndex(params: {
  tabs: readonly TabRecord[];
  sourceGroupId: number;
  targetGroupId: number;
  placeAfter: boolean;
}): number | undefined {
  const { tabs, sourceGroupId, targetGroupId, placeAfter } = params;
  const order: number[] = [];
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    if (tab.groupId === NO_GROUP || order.includes(tab.groupId)) continue;
    order.push(tab.groupId);
  }
  // 先摘掉自身再定位：否则「拖到目标之后」会被自身占位顶偏一位。
  const withoutSource = order.filter((id) => id !== sourceGroupId);
  const targetAt = withoutSource.indexOf(targetGroupId);
  if (targetAt === -1) return undefined;
  const next = placeAfter ? targetAt + 1 : targetAt;
  // 落到末尾时用 -1（接口约定的「放到窗口最后」）：index 等于组数不保证被接受。
  return next >= withoutSource.length ? -1 : next;
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

/** 复制标签（对标浏览器原生右键「复制标签页」），返回是否成功（某些页面不可复制）。 */
export async function duplicateTab(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.duplicate(tabId);
    return true;
  } catch (error) {
    logDegraded('tabs', '复制标签失败', error);
    // 某些特殊页面无法复制
    return false;
  }
}

/**
 * 将若干标签归入一个原生组（固定文件夹 → 原生组桥接用）。传入 groupId 表示加入既有组，
 * 缺省表示新建组。返回组 id；失败返回 undefined。
 */
export async function groupTabs(
  tabIds: readonly number[],
  groupId?: number
): Promise<number | undefined> {
  if (tabIds.length === 0) return undefined;
  const ids = [...tabIds] as [number, ...number[]];
  try {
    return await browser.tabs.group(
      groupId === undefined ? { tabIds: ids } : { tabIds: ids, groupId }
    );
  } catch (error) {
    logDegraded('tabs', groupId === undefined ? '创建原生标签组失败' : '加入原生标签组失败', error);
    return undefined;
  }
}

/**
 * 等待标签被真正归入目标组（确定式收敛）。Chrome 在 tabs.group() resolve 后，成员 tab 的
 * groupId 可见性仍存在几十到几百 ms 的收敛窗口：此刻立即 query 可能仍拿到旧值。写操作后
 * 主动等到状态可见再刷新 UI，把「切一下 tab 才显示」的延迟变为确定性的收敛。
 * best-effort：超时未收敛不抛错，由事件驱动最终兜底。
 */
/** 收敛轮询次数与间隔（合计约 1.2s）。 */
const GROUP_ASSIGN_MAX_ATTEMPTS = 6;
const GROUP_ASSIGN_POLL_MS = 200;

export async function waitForTabGroupAssignment(
  tabIds: readonly number[],
  groupId: number,
  maxAttempts = GROUP_ASSIGN_MAX_ATTEMPTS,
  intervalMs = GROUP_ASSIGN_POLL_MS
): Promise<void> {
  const target = new Set(tabIds);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const live = tabs.filter((tab) => tab.id !== undefined && target.has(tab.id));
      // 仅要求「仍存活」的成员已入组；中途关闭的标签不阻塞。
      if (live.every((tab) => (tab.groupId ?? NO_GROUP) === groupId)) return;
      lastError = undefined;
    } catch (error) {
      // 单次查询失败视为未收敛继续尝试；但全程失败必须留痕，否则收敛等待变成一条死路径。
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError !== undefined) {
    logDegraded(
      'tabs',
      `等待 ${tabIds.length} 个标签入组 ${groupId} 期间标签查询持续失败`,
      lastError
    );
  }
}

/**
 * 「组已不存在」判定：Chrome 的报错文案为 `No group with id: N`。这类失败按 quiet 记录，
 * 不写进扩展错误页。判据是英文报错文案，非英语环境可能不命中，故只用于降噪，不用于判断
 * 组是否真的消失（权威判定是 groupExists 的三态）。唯一实现在 platform/tabGroups。
 */
const isMissingGroupError = isMissingGroupErrorMessage;

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
    logDegraded('tabs', `更新分组 ${groupId} 的标题/颜色失败`, error, {
      quiet: isMissingGroupError(error)
    });
  }
}

/** 重命名原生组。 */
export async function renameGroup(groupId: number, title: string): Promise<void> {
  try {
    await tabGroups.update(groupId, { title });
  } catch (error) {
    logDegraded('tabs', '重命名分组失败', error, { quiet: isMissingGroupError(error) });
    // 标签组可能已解散
  }
}

/** 改变原生组颜色。 */
export async function recolorGroup(groupId: number, color: string): Promise<void> {
  try {
    await tabGroups.update(groupId, { color });
  } catch (error) {
    logDegraded('tabs', '修改分组颜色失败', error, { quiet: isMissingGroupError(error) });
    // 标签组可能已解散
  }
}

/**
 * 原生组是否仍存在。返回三态而非布尔：查询本身可能因瞬时故障抛错，塌缩成 false 会让
 * 调用方判成「组已不存在」并据此清理记账，而组其实还在，成为永久孤儿组。
 */
export async function groupExists(groupId: number): Promise<'exists' | 'missing' | 'failed'> {
  try {
    await tabGroups.get(groupId);
    return 'exists';
  } catch (error) {
    // 只有确认是「组不存在」才报 missing；其余一律 failed 并留痕。
    if (isMissingGroupErrorMessage(error)) return 'missing';
    logDegraded('tabs', `查询分组 ${groupId} 是否存在失败`, error);
    return 'failed';
  }
}

/**
 * 解散原生组：把组内全部标签移出分组（标签保留不关闭，空组由浏览器自动回收）。
 * 三态：'removed' 组存在且已解散；'missing' 组已不存在（应清理记录而非重试）；
 * 'failed' 真实失败（可重试）。
 */
export async function removeGroup(groupId: number): Promise<'removed' | 'missing' | 'failed'> {
  let members: ChromeTab[];
  try {
    members = await browser.tabs.query({ groupId });
  } catch (error) {
    logDegraded('tabs', `查询分组 ${groupId} 成员失败`, error);
    return 'failed';
  }

  const state = await groupExists(groupId);
  // 查询失败绝不能当「已不存在」处理：那会让调用方清掉记账而留下真组（孤儿组）。
  if (state === 'failed') return 'failed';
  // 组已不存在：视为目标已达成，调用方应清理记录而非重试。
  if (state === 'missing') return 'missing';

  try {
    const tabIds = members.map((tab) => tab.id).filter((id): id is number => id !== undefined);
    if (tabIds.length > 0) await browser.tabs.ungroup(tabIds as [number, ...number[]]);
    return 'removed';
  } catch (error) {
    logDegraded('tabs', `解散分组 ${groupId} 失败`, error);
    return 'failed';
  }
}

/** 移动原生组到指定索引（组排序）。返回是否成功（组可能已解散）。 */
export async function moveGroup(groupId: number, index: number): Promise<boolean> {
  try {
    await tabGroups.move(groupId, { index });
    return true;
  } catch (error) {
    logDegraded('tabs', '移动分组失败', error);
    // 标签组可能已解散
    return false;
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

/** 监听浏览器多选高亮变化，返回注销函数。 */
export function onTabHighlighted(handler: (tabIds: readonly number[]) => void): () => void {
  const listener = (info: { tabIds: number[] }): void => handler(info.tabIds);
  browser.tabs.onHighlighted.addListener(listener);
  return () => browser.tabs.onHighlighted.removeListener(listener);
}

/**
 * 监听任意窗口的标签增删/更新（多窗口分段的数据刷新信号）。事件不携带窗口过滤——
 * Chrome 的 tabs 事件本身是全局的，消费方自行判断是否相关（onUpdated 高频，消费方须自行节流）。
 */
export function onAllTabsChanged(handler: () => void): () => void {
  const listener = (): void => handler();
  browser.tabs.onCreated.addListener(listener);
  browser.tabs.onRemoved.addListener(listener);
  browser.tabs.onUpdated.addListener(listener);
  // 跨窗口移动也要刷新，否则分段归属陈旧。这两个事件在部分环境（含 fake-browser）未实现
  // 且会抛错，属可选增强：订阅失败不影响主路径，故整体吞掉。
  try {
    browser.tabs.onAttached?.addListener(listener);
    browser.tabs.onDetached?.addListener(listener);
  } catch {
    // 环境不支持跨窗口移动事件
  }
  return () => {
    browser.tabs.onCreated.removeListener(listener);
    browser.tabs.onRemoved.removeListener(listener);
    browser.tabs.onUpdated.removeListener(listener);
    try {
      browser.tabs.onAttached?.removeListener(listener);
      browser.tabs.onDetached?.removeListener(listener);
    } catch {
      // 同上
    }
  };
}

/**
 * 解析「恢复」类操作的目标窗口：优先回到记录中的原窗口，原窗口已关闭则退回当前聚焦窗口。
 * 只记录「关了什么」而不记录「从哪关的」，用户切到另一个窗口再撤销时标签会恢复到错误的窗口。
 */
export async function resolveRestoreWindowId(preferred?: number): Promise<number | undefined> {
  if (preferred !== undefined) {
    const win = await browser.windows.get(preferred).catch(() => undefined);
    if (win?.id !== undefined) return win.id;
  }
  const focused = await browser.windows.getLastFocused().catch(() => undefined);
  if (focused?.id !== undefined) return focused.id;
  // 两个查询都拿不到结果（窗口 API 不可用）时只能相信记录值。此时若窗口确实已不存在，
  // 标签创建会失败并进入 failed 明细（用户可见、可重试），不会退化成静默失败。
  return preferred;
}

/** 查询全部窗口的普通标签（跨窗口搜索数据源）。 */
export async function queryAllWindowTabs(): Promise<TabRecord[]> {
  const queriedTabs = await browser.tabs.query({ windowType: 'normal' });
  return queriedTabs.map(mapTab);
}

/**
 * 批量新建标签并导航（「打开文件夹全部条目」/「恢复快照」等显式打开场景用）。每个 URL 先申请
 * 复用豁免再创建——显式打开不应被 uniqueUrlTabs 复用引擎合并；返回实际创建成功的标签数。
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
  // 并发创建（每条先发豁免）：并发下完成顺序不定，追加到末尾的标签次序会与入参不一致。
  // 结果数组按入参同序（mapWithConcurrency 只保证这一点），最后一次性 move 回位——
  // 比串行创建快得多，又不必依赖 create 的完成顺序。
  const results = await mapWithConcurrency(urls, DEFAULT_CONCURRENCY, async (url) => {
    try {
      if (target !== undefined) await grantReuseAllowance(target, url);
      const created = await browser.tabs.create({
        url,
        active,
        ...(target !== undefined ? { windowId: target } : {})
      });
      return created.id ?? null;
    } catch (error) {
      logDegraded('tabs', '批量新建标签：单条创建失败', error);
      // 无效 URL 跳过，其余继续
      return null;
    }
  });
  const createdIds = results.filter((id): id is number => id !== null);
  if (target !== undefined && createdIds.length > 1) {
    // 落位失败不影响「已打开」这一事实，但顺序会与入参不同，必须留痕而不是静默。
    await browser.tabs.move(createdIds, { windowId: target, index: -1 }).catch((error) => {
      logDegraded('tabs', '批量新建标签：按入参顺序落位失败，标签顺序可能与预期不同', error);
    });
  }
  return createdIds.length;
}
