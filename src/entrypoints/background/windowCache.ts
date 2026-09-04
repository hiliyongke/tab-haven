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
export const skipAutoSaveWindowIds = new Set<number>();

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
    if (windowTabsFlushTimer) return;
    windowTabsFlushTimer = setTimeout(flushWindowTabs, 800);
  } catch (error) {
    logDegraded('window-cache', '窗口缓存读取失败', error);
    // 窗口可能已关闭，忽略
  }
}

/** 重新扫描某窗口标签并写入缓存（防抖 600ms）。 */
function scheduleWindowRefresh(windowId: number): void {
  const existing = windowRefreshTimers.get(windowId);
  if (existing) clearTimeout(existing);
  windowRefreshTimers.set(
    windowId,
    setTimeout(() => {
      windowRefreshTimers.delete(windowId);
      void refreshWindowTabs(windowId);
    }, 600)
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
  if (skipAutoSaveWindowIds.delete(windowId)) return;
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
