import { browser } from 'wxt/browser';
import { z } from 'zod';
import { SnapshotTabSchema, type SnapshotTab } from '@/core/schema/models';
import type { TabGroupRecord } from '@/core/tab-types';
import { mapTab, mapTabGroup } from '@/platform/tabs';
import { tabGroups } from '@/platform/tabGroups';
import { settingsRepository } from '@/platform/storage/repositories';
import { buildSnapshot, collectSnapshotTabs, persistSnapshot } from '@/platform/snapshot/snapshots';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';
import { createSerialChain } from '@/core/util/concurrency';
import { logDegraded } from '@/platform/diagnostics';
import { SKIP_AUTO_SAVE_KEY, WINDOW_TABS_KEY } from '@/platform/storage/keys';
import { listNormalWindowIds } from '@/platform/windows';

type WindowTabsCache = Record<string, SnapshotTab[]>;
/** 缓存内容 schema：session 中的脏条目（异常写入）必须被隔离丢弃，
 * 否则整条关窗快照在 persistSnapshot 的 zod 校验处整体写盘失败。 */
const WindowTabsCacheSchema = z.record(z.string(), z.array(SnapshotTabSchema));
let memWindowTabs: WindowTabsCache = {};
let windowTabsFlushTimer: ReturnType<typeof setTimeout> | undefined;
const windowRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** 内存缓存 → storage.session 的落盘防抖（合并高频刷新，防 SW 回收后丢缓存）。 */
const WINDOW_TABS_FLUSH_DEBOUNCE_MS = 800;
/** 下一次关闭时跳过自动保存的窗口（归档流程已自行保存，防重复快照）。值为发放时间戳。 */
const skipAutoSaveWindowIds = new Map<number, number>();

/**
 * 跳过标记有效期。归档 → 关窗正常在秒级完成；若窗口未随归档关闭
 * （tabs.remove 部分失败），标记不得残留到该窗口未来的手动关闭，
 * 否则误跳过一次正当的关窗自动保存。
 */
const SKIP_AUTO_SAVE_TTL_MS = 30_000;

/** session 镜像中的标记记录（带发放时间戳；过期即作废并在读写时随手清理）。 */
interface SkipMarkerRecord {
  id: number;
  at: number;
}

function parseSkipMarkers(raw: unknown, now: number): SkipMarkerRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is SkipMarkerRecord =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as SkipMarkerRecord).id === 'number' &&
      typeof (v as SkipMarkerRecord).at === 'number' &&
      now - (v as SkipMarkerRecord).at <= SKIP_AUTO_SAVE_TTL_MS
  );
}

/**
 * 跳过标记的 session 镜像 key。
 *
 * 纯内存标记在「归档 sendMessage → 实际关窗」之间若 SW 被回收即丢失，
 * 关窗会重复写入一条同内容 auto 快照；镜像到 session 后 SW 重启也能命中。
 */
/** 跳过标记 read-modify-write 串行链（多窗口连续归档时防交错丢标记）。 */
const skipMarkerChain = createSerialChain();

/** 标记「下一次关闭该窗口时跳过自动保存」（内存 + session 镜像双写，带 TTL）。 */
export function markSkipAutoSave(windowId: number): Promise<void> {
  // 链尾统一兜底：任何一次 reject 都会让此后每个 markSkipAutoSave 不再 resolve，
  // 而归档流程正等着它的 sendResponse —— 表现为每次归档都挂满 ack 超时才降级。
  // 失败一律经诊断留痕（内存标记此刻已置位，SW 不回收则语义不变，但 session
  // 镜像丢失必须可观测，否则「关窗重复写一条 auto 快照」无从定位）。
  return skipMarkerChain.enqueueSettled(
    async () => {
      const now = Date.now();
      skipAutoSaveWindowIds.set(windowId, now);
      const sessionArea = browser.storage?.session;
      if (!sessionArea) return;
      const rec = await sessionArea.get(SKIP_AUTO_SAVE_KEY);
      // 读写时随手清理过期项（不在 TTL 内的记录一律丢弃，自然淘汰）。
      const list = parseSkipMarkers(rec[SKIP_AUTO_SAVE_KEY], now);
      if (!list.some((m) => m.id === windowId)) list.push({ id: windowId, at: now });
      await sessionArea.set({ [SKIP_AUTO_SAVE_KEY]: list });
    },
    (error) => logDegraded('window-cache', '跳过自动保存标记写入失败', error)
  );
}

/** 消费「跳过自动保存」标记（内存优先，session 镜像兜底）；仅未过期才命中。 */
async function consumeSkipAutoSave(windowId: number): Promise<boolean> {
  const now = Date.now();
  const memAt = skipAutoSaveWindowIds.get(windowId);
  skipAutoSaveWindowIds.delete(windowId);
  const inMem = memAt !== undefined && now - memAt <= SKIP_AUTO_SAVE_TTL_MS;
  let inSession = false;
  const sessionArea = browser.storage?.session;
  if (sessionArea) {
    try {
      const rec = await sessionArea.get(SKIP_AUTO_SAVE_KEY);
      const list = parseSkipMarkers(rec[SKIP_AUTO_SAVE_KEY], now);
      const hit = list.some((m) => m.id === windowId);
      // 无论是否命中都回写一次：顺带清掉过期项与被消费的标记。
      await sessionArea.set({ [SKIP_AUTO_SAVE_KEY]: list.filter((m) => m.id !== windowId) });
      inSession = hit;
    } catch (error) {
      // 按未命中处理（不阻断关窗快照），但必须留痕：session 镜像存在的理由正是
      // 内存标记会随 SW 重启丢失，读失败 + 内存已丢 ⇒ 归档已保存的窗口会被
      // 再写一条重复快照，而归因时完全无从下手。
      logDegraded(
        'window-cache',
        `窗口 ${windowId} 跳过自动保存标记读取失败，按未命中处理（可能产生重复关窗快照）`,
        error
      );
    }
  }
  return inMem || inSession;
}

/**
 * 每窗口最近一次激活的标签 id（onActivated 维护）。
 * 「新建标签位置 = 激活标签之后」的定位锚点：onCreated 时新标签已被 Chrome
 * 激活，直接 query active 只会查到它自己，必须用激活前的记录。
 */
/**
 * 已关闭窗口集合（值为标记到期时间）：在途 refresh 完成时窗口若已关闭，
 * 缓存写回会复活幽灵键。
 *
 * 采用「到期时间 + 读时惰性清理」而非定时器删除：SW 被回收时裸 setTimeout 会被
 * 吞掉，集合会在 SW 存活期内随每次关窗单调增长。
 */
const removedWindowIds = new Map<number, number>();
/** 已关闭窗口标记的保留时长（覆盖在途 refresh 的防抖 + 查询往返，之后即失效）。 */
const REMOVED_MARK_TTL_MS = 5_000;

/** 标记窗口已关闭（顺手清理已过期的历史标记）。 */
function markWindowRemoved(windowId: number): void {
  const now = Date.now();
  for (const [id, at] of removedWindowIds) {
    if (now > at) removedWindowIds.delete(id);
  }
  removedWindowIds.set(windowId, now + REMOVED_MARK_TTL_MS);
}

/** 窗口是否刚被关闭（标记过期即失效并移除）。 */
function isWindowRemoved(windowId: number): boolean {
  const at = removedWindowIds.get(windowId);
  if (at === undefined) return false;
  if (Date.now() > at) {
    removedWindowIds.delete(windowId);
    return false;
  }
  return true;
}

const lastActiveTabIds = new Map<number, number>();

/** 记录窗口最后激活的标签（供「回到上一个标签」类动作在关闭后定位）。 */
export function recordActiveTab(windowId: number, tabId: number): void {
  lastActiveTabIds.set(windowId, tabId);
}

/** 取窗口最后激活的标签 id；窗口未见过时返回 undefined。 */
export function getLastActiveTabId(windowId: number): number | undefined {
  return lastActiveTabIds.get(windowId);
}

/** 把内存缓存刷入 storage.session（防 SW 回收后丢失）。 */
function flushWindowTabs(): void {
  windowTabsFlushTimer = undefined;
  const sessionArea = browser.storage?.session;
  if (!sessionArea) return;
  void sessionArea.set({ [WINDOW_TABS_KEY]: memWindowTabs }).catch((error) => {
    // session 写失败的直接后果是：SW 被回收后该窗口的关窗自动快照**没有源数据**，
    // 快照会静默缺内容。过去这里吞错不留痕，「快照为什么少了标签」无从查起。
    logDegraded('window-cache', '窗口缓存落盘失败：SW 回收后关窗快照会缺少本次内容', error);
  });
}

/**
 * 窗口标签 + 原生组 → 轻量快照条目。
 *
 * 采集口径（仅 http(s)、静音状态、组标题/颜色）的唯一实现是
 * `platform/snapshot/snapshots` 的 `collectSnapshotTabs`：关窗自动保存、定时自动
 * 快照、面板手动保存三处此前各写一份，新增字段（或改掉「内部页不入库」这类
 * 规则）必然只改一处，表现为「定时保存的快照没有分组」这类无从解释的差异。
 */
function collectTabs(
  rawTabs: readonly Parameters<typeof mapTab>[0][],
  groups: readonly TabGroupRecord[]
): SnapshotTab[] {
  return collectSnapshotTabs(
    rawTabs.map((raw) => mapTab(raw)),
    groups
  );
}

/**
 * 查询某窗口的原生组；失败返回 undefined 并留痕。
 *
 * 刻意**不**退化成空数组：空数组等价于「该窗口没有组」，下游会拿它构建一份
 * 残缺缓存去覆盖上一份完整缓存，关窗快照的分组信息就此永久丢失且零痕迹。
 * 「查询失败」必须能与「确实没有组」区分开，由调用方决定要不要保留旧缓存。
 */
async function queryWindowGroups(windowId: number): Promise<TabGroupRecord[] | undefined> {
  try {
    return (await tabGroups.query({ windowId })).map(mapTabGroup);
  } catch (error) {
    logDegraded('window-cache', `窗口 ${windowId} 原生组查询失败`, error);
    return undefined;
  }
}

/** 查询某窗口当前标签（含原生组），更新内存缓存并安排落盘。 */
async function refreshWindowTabs(windowId: number): Promise<void> {
  let rawTabs: Parameters<typeof mapTab>[0][];
  try {
    rawTabs = await browser.tabs.query({ windowId });
  } catch (error) {
    logDegraded('window-cache', `窗口 ${windowId} 标签查询失败，跳过本次缓存更新`, error);
    return;
  }
  // 无痕窗口不得进缓存：缓存的唯一用途是「关窗时生成可恢复快照」，而无痕标签的
  // URL 与标题一旦落进快照就与定时自动快照的刻意排除（listNormalWindowIds）相反。
  // 窗口类型无法从标签事件里拿到，但标签自带 incognito —— 这是零额外 IPC 的判定点。
  if (rawTabs.some((raw) => raw.incognito === true)) return;
  const groups = await queryWindowGroups(windowId);
  // 在途刷新与关窗竞态：查询返回前窗口已被关闭时，把结果写回缓存会
  // 以空数组/残余数据复活已清理的键（驻留到浏览器重启）。丢弃即可。
  if (isWindowRemoved(windowId)) return;
  if (groups === undefined && memWindowTabs[String(windowId)] !== undefined) {
    // 组查询失败时宁可保留上一份**完整**缓存，也不用缺分组信息的新数据覆盖它：
    // 缓存的用途是「SW 被回收后仍能生成关窗快照」，稍旧但完整的数据价值更高；
    // 组查询失败是瞬时故障，下一个标签事件（防抖后）即自愈。
    return;
  }
  const list = collectTabs(rawTabs, groups ?? []);
  memWindowTabs[String(windowId)] = list;
  // SW 冷启动锚点补种：lastActiveTabIds 是纯内存态，SW 回收后「新建标签位置 =
  // 激活标签之后」在第一次新建时拿不到锚点会静默失效；查询结果中的激活标签
  // 即最近一次锚点（仅缺省时补种，之后由 onActivated 维护）。
  if (!lastActiveTabIds.has(windowId)) {
    const active = rawTabs.find((tab) => tab.active);
    if (typeof active?.id === 'number') lastActiveTabIds.set(windowId, active.id);
  }
  if (windowTabsFlushTimer) return;
  windowTabsFlushTimer = setTimeout(flushWindowTabs, WINDOW_TABS_FLUSH_DEBOUNCE_MS);
}

/**
 * 重新扫描某窗口的防抖窗口（毫秒）。
 *
 * 该值是「关窗自动快照内容滞后」的主要来源之一：关窗瞬间读到的缓存最多滞后
 * 「本防抖 + 落盘防抖」，最后几百毫秒的开关标签会丢进/带进快照。
 * 从 600ms 收紧到 250ms：事件合并收益仍在，滞后上限明显收窄。
 * 与 WINDOW_TABS_FLUSH_DEBOUNCE_MS 是两段独立的延迟，调参须同时看两者。
 */
const WINDOW_REFRESH_DEBOUNCE_MS = 250;

function scheduleWindowRefresh(windowId: number): void {
  const existing = windowRefreshTimers.get(windowId);
  if (existing) clearTimeout(existing);
  windowRefreshTimers.set(
    windowId,
    setTimeout(() => {
      windowRefreshTimers.delete(windowId);
      void refreshWindowTabs(windowId);
    }, WINDOW_REFRESH_DEBOUNCE_MS)
  );
}

/** 启动：从 session 恢复缓存，并为当前所有窗口建索引。 */
async function initWindowTabsCache(): Promise<void> {
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const rec = await sessionArea.get(WINDOW_TABS_KEY);
      const val = rec[WINDOW_TABS_KEY];
      // 缓存必须过 schema：session 中的脏条目会让该窗口的关窗快照在
      // persistSnapshot 校验处整体失败（快照丢失而非只丢坏条目）。
      const parsed = WindowTabsCacheSchema.safeParse(val);
      if (parsed.success) {
        memWindowTabs = parsed.data;
      } else {
        memWindowTabs = {};
        logDegraded('window-cache', 'session 窗口缓存数据损坏，已丢弃并从空态重建');
      }
    }
    // 窗口类型/无痕口径与定时自动快照、自动分组共用 `listNormalWindowIds`：
    // 三条快照路径此前各自一份判定，无痕窗口只会在「关窗」这条路上被写进持久快照。
    const windowIds = await listNormalWindowIds();
    for (const windowId of windowIds) {
      await refreshWindowTabs(windowId);
    }
  } catch (error) {
    logDegraded('window-cache', '窗口缓存写入失败', error);
    // 忽略：不影响其它功能
  }
}

/** 窗口关闭：用缓存的标签自动存为快照（关窗自动保存）。 */
async function handleWindowRemoved(windowId: number): Promise<void> {
  // 取消该窗口挂起的防抖重查：窗口已不存在，查询必失败（只剩一条无效诊断噪音）。
  const pendingTimer = windowRefreshTimers.get(windowId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    windowRefreshTimers.delete(windowId);
  }
  // 标记窗口已关闭：在途 refresh 完成后据此丢弃结果（防幽灵键复活，标记带 TTL）。
  markWindowRemoved(windowId);
  lastActiveTabIds.delete(windowId);
  const idKey = String(windowId);
  let tabs = memWindowTabs[idKey];
  if (!tabs) {
    try {
      const sessionArea = browser.storage?.session;
      if (sessionArea) {
        const rec = await sessionArea.get(WINDOW_TABS_KEY);
        const cache = WindowTabsCacheSchema.safeParse(rec[WINDOW_TABS_KEY]);
        if (cache.success) tabs = cache.data[idKey];
      }
    } catch (error) {
      logDegraded('window-cache', '窗口缓存清理失败', error);
      // 忽略
    }
  }
  delete memWindowTabs[idKey];
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const rec = await sessionArea.get(WINDOW_TABS_KEY);
      const parsed = WindowTabsCacheSchema.safeParse(rec[WINDOW_TABS_KEY]);
      if (parsed.success) {
        const cache = { ...parsed.data };
        if (cache[idKey]) {
          delete cache[idKey];
          await sessionArea.set({ [WINDOW_TABS_KEY]: cache }).catch((error) => {
            logDegraded('window-cache', '窗口缓存条目清理后落盘失败', error);
          });
        }
      }
    }
  } catch (error) {
    logDegraded('window-cache', '窗口缓存操作失败', error);
    // 忽略
  }
  // 归档流程（archiveCurrentWindow）已自行保存并请求跳过本次自动保存。
  if (await consumeSkipAutoSave(windowId)) return;
  if (!tabs || tabs.length === 0) return;
  const settings = await settingsRepository.read();
  if (!settings.autoSaveSnapshots) return;
  const snapshot = buildSnapshot({
    name: '',
    fallbackName: DEFAULT_SNAPSHOT_NAMES.auto,
    origin: 'auto',
    windowId,
    tabs
  });
  // 写盘失败（quota 超限等）只告警：自动保存是兜底链路，不应让异常逃逸为未捕获 rejection。
  await persistSnapshot(snapshot).catch((error) =>
    logDegraded('window-cache', '关窗自动快照写入失败', error)
  );
}

export { scheduleWindowRefresh, initWindowTabsCache, handleWindowRemoved, refreshWindowTabs };
