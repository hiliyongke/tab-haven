import { browser } from 'wxt/browser';
import type { SnapshotTab } from '@/core/schema/models';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { mapTab, mapTabGroup } from '@/platform/tabs';
import { settingsRepository } from '@/platform/storage/repositories';
import { buildSnapshot, persistSnapshot } from '@/platform/snapshot/snapshots';
import { t } from '@/i18n/headless';
import { logDegraded } from '@/platform/diagnostics';

const WINDOW_TABS_KEY = 'tabs.window-tabs.v1';
type WindowTabsCache = Record<string, SnapshotTab[]>;
let memWindowTabs: WindowTabsCache = {};
let windowTabsFlushTimer: ReturnType<typeof setTimeout> | undefined;
const windowRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** 下一次关闭时跳过自动保存的窗口（归档流程已自行留档，防重复快照）。 */
const skipAutoSaveWindowIds = new Set<number>();

/**
 * 跳过标记的 session 镜像 key。
 *
 * 纯内存标记在「归档 sendMessage → 实际关窗」之间若 SW 被回收即丢失，
 * 关窗会重复写入一条同内容 auto 快照；镜像到 session 后 SW 重启也能命中。
 */
const SKIP_AUTO_SAVE_KEY = 'tabs.skip-auto-save-once';
/** 跳过标记 read-modify-write 串行链（多窗口连续归档时防交错丢标记）。 */
let skipMarkerChain: Promise<void> = Promise.resolve();

/** 标记「下一次关闭该窗口时跳过自动保存」（内存 + session 镜像双写）。 */
export function markSkipAutoSave(windowId: number): Promise<void> {
  const step = skipMarkerChain.then(async () => {
    skipAutoSaveWindowIds.add(windowId);
    const sessionArea = browser.storage?.session;
    if (!sessionArea) return;
    try {
      const rec = await sessionArea.get(SKIP_AUTO_SAVE_KEY);
      const raw: unknown = rec[SKIP_AUTO_SAVE_KEY];
      const list = Array.isArray(raw) ? raw.filter((v): v is number => typeof v === 'number') : [];
      if (!list.includes(windowId)) list.push(windowId);
      await sessionArea.set({ [SKIP_AUTO_SAVE_KEY]: list });
    } catch {
      // session 不可用时内存标记仍在：SW 不回收则语义不变
    }
  });
  skipMarkerChain = step;
  return step;
}

/** 消费「跳过自动保存」标记（内存优先，session 镜像兜底）；返回是否命中。 */
async function consumeSkipAutoSave(windowId: number): Promise<boolean> {
  const inMem = skipAutoSaveWindowIds.delete(windowId);
  let inSession = false;
  const sessionArea = browser.storage?.session;
  if (sessionArea) {
    try {
      const rec = await sessionArea.get(SKIP_AUTO_SAVE_KEY);
      const raw: unknown = rec[SKIP_AUTO_SAVE_KEY];
      const list = Array.isArray(raw) ? raw.filter((v): v is number => typeof v === 'number') : [];
      if (list.includes(windowId)) {
        inSession = true;
        await sessionArea.set({ [SKIP_AUTO_SAVE_KEY]: list.filter((id) => id !== windowId) });
      }
    } catch {
      // 忽略：按未命中处理（与历史行为一致）
    }
  }
  return inMem || inSession;
}

/**
 * 每窗口最近一次激活的标签 id（onActivated 维护）。
 * 「新建标签位置 = 激活标签之后」的定位锚点：onCreated 时新标签已被 Chrome
 * 激活，直接 query active 只会查到它自己，必须用激活前的记录。
 */
const lastActiveTabIds = new Map<number, number>();

export function recordActiveTab(windowId: number, tabId: number): void {
  lastActiveTabIds.set(windowId, tabId);
}

export function getLastActiveTabId(windowId: number): number | undefined {
  return lastActiveTabIds.get(windowId);
}

/** 把内存缓存刷入 storage.session（防 SW 回收后丢失）。 */
function flushWindowTabs(): void {
  windowTabsFlushTimer = undefined;
  const sessionArea = browser.storage?.session;
  if (!sessionArea) return;
  void sessionArea.set({ [WINDOW_TABS_KEY]: memWindowTabs }).catch(() => {});
}

/**
 * 窗口标签 + 原生组 → 轻量快照条目（仅 http(s) 页面可恢复，其余跳过）。
 * 记录静音状态与所在组标题/颜色，恢复时可完整还原现场。
 */
function collectTabs(
  rawTabs: readonly Parameters<typeof mapTab>[0][],
  groups: readonly TabGroupRecord[]
): SnapshotTab[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const out: SnapshotTab[] = [];
  for (const raw of rawTabs) {
    const tab: TabRecord = mapTab(raw);
    // chrome:// / about: 等内部页无法以 URL 重新创建，收入快照只会成为死条目。
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) continue;
    const group = tab.groupId !== NO_GROUP ? groupById.get(tab.groupId) : undefined;
    out.push({
      url: tab.url,
      title: tab.title || '',
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      muted: tab.muted ?? false,
      groupTitle: group?.title || undefined,
      groupColor: group?.color || undefined
    });
  }
  return out;
}

/** 查询某窗口当前标签（含原生组），更新内存缓存并安排落盘。 */
async function refreshWindowTabs(windowId: number): Promise<void> {
  try {
    const [rawTabs, rawGroups] = await Promise.all([
      browser.tabs.query({ windowId }),
      browser.tabGroups.query({ windowId }).catch(() => [])
    ]);
    const list = collectTabs(rawTabs, rawGroups.map(mapTabGroup));
    memWindowTabs[String(windowId)] = list;
    // SW 冷启动锚点补种：lastActiveTabIds 是纯内存态，SW 回收后「新建标签位置 =
    // 激活标签之后」在第一次新建时拿不到锚点会静默失效；查询结果中的激活标签
    // 即最近一次锚点（仅缺省时补种，之后由 onActivated 维护）。
    if (!lastActiveTabIds.has(windowId)) {
      const active = rawTabs.find((tab) => tab.active);
      if (typeof active?.id === 'number') lastActiveTabIds.set(windowId, active.id);
    }
    if (windowTabsFlushTimer) return;
    windowTabsFlushTimer = setTimeout(flushWindowTabs, 800);
  } catch (error) {
    logDegraded('window-cache', '窗口缓存读取失败', error);
    // 窗口可能已关闭，忽略
  }
}

/**
 * 重新扫描某窗口标签并写入缓存（防抖 250ms）。
 *
 * 防抖窗口是「关窗自动快照内容滞后」的主要来源之一：关窗瞬间读到的缓存
 * 最多滞后「防抖 + 落盘防抖」，最后几百毫秒的开关标签会丢进/带进快照。
 * 从 600ms 收紧到 250ms：事件合并收益仍在，滞后上限明显收窄。
 */
function scheduleWindowRefresh(windowId: number): void {
  const existing = windowRefreshTimers.get(windowId);
  if (existing) clearTimeout(existing);
  windowRefreshTimers.set(
    windowId,
    setTimeout(() => {
      windowRefreshTimers.delete(windowId);
      void refreshWindowTabs(windowId);
    }, 250)
  );
}

/** 启动：从 session 恢复缓存，并为当前所有窗口建索引。 */
async function initWindowTabsCache(): Promise<void> {
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const rec = await sessionArea.get(WINDOW_TABS_KEY);
      const val = rec[WINDOW_TABS_KEY];
      if (val && typeof val === 'object') memWindowTabs = val as WindowTabsCache;
    }
    const wins = await browser.windows.getAll({ populate: false }).catch(() => []);
    for (const win of wins) {
      if (typeof win.id === 'number') await refreshWindowTabs(win.id);
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
  lastActiveTabIds.delete(windowId);
  const idKey = String(windowId);
  let tabs = memWindowTabs[idKey];
  if (!tabs) {
    try {
      const sessionArea = browser.storage?.session;
      if (sessionArea) {
        const rec = await sessionArea.get(WINDOW_TABS_KEY);
        const cache = rec[WINDOW_TABS_KEY] as WindowTabsCache | undefined;
        if (cache) tabs = cache[idKey];
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
      const cache = (rec[WINDOW_TABS_KEY] as WindowTabsCache) ?? {};
      if (cache[idKey]) {
        delete cache[idKey];
        await sessionArea.set({ [WINDOW_TABS_KEY]: cache }).catch(() => {});
      }
    }
  } catch (error) {
    logDegraded('window-cache', '窗口缓存操作失败', error);
    // 忽略
  }
  // 归档流程（archiveCurrentWindow）已自行留档并请求跳过本次自动保存。
  if (await consumeSkipAutoSave(windowId)) return;
  if (!tabs || tabs.length === 0) return;
  const settings = await settingsRepository.read();
  if (!settings.autoSaveSnapshots) return;
  const snapshot = buildSnapshot({
    name: '',
    fallbackName: t('snapshots.defaultAutoName'),
    origin: 'auto',
    windowId,
    tabs
  });
  // 写盘失败（quota 超限等）只告警：自动保存是兜底链路，不应让异常逃逸为未捕获 rejection。
  await persistSnapshot(snapshot).catch((error) =>
    console.warn('[snapshots] auto-save failed', error)
  );
}

export { scheduleWindowRefresh, initWindowTabsCache, handleWindowRemoved, refreshWindowTabs };
