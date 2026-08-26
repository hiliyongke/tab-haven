import { create } from 'zustand';
import { browser } from 'wxt/browser';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { queryCurrentWindowTabs } from '@/platform/tabs';
import { SkipAutoSaveOnceMessageSchema } from '@/platform/messages';
import { snapshotsRepository } from '@/platform/storage/repositories';
import {
  buildSnapshot,
  parseOneTab,
  persistSnapshot,
  restoreSnapshot
} from '@/platform/snapshot/snapshots';

/**
 * 快照 store（D5.1/D5.2）：命名快照的读取、保存、恢复、删除、重命名。
 * 扩展（D7 / 空间轻量化 / 竞品导入）：归档中心、空间快照、OneTab 导入，共用同一恢复管线。
 *
 * 与 undoStore 同构：数据经 snapshotsRepository（chrome.storage.local + zod）落盘，
 * store 仅持有内存态供 UI 渲染。关窗自动保存由 background SW 直接写入仓库，
 * 此处 load() 在面板启动时拉取最新列表。
 */

/** 由窗口标签抽取轻量快照条目（仅 http(s) 页面可恢复，其余不入档）。 */
function toSnapTabs(tabs: Awaited<ReturnType<typeof queryCurrentWindowTabs>>): SnapshotTab[] {
  return tabs
    .map((tab) => ({
      url: tab.url ?? '',
      title: tab.title || '',
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned
    }))
    .filter((tab) => /^https?:\/\//i.test(tab.url));
}

interface SnapshotState {
  snapshots: Snapshot[];
  ready: boolean;

  /** 拉取快照列表（面板启动时调用）。 */
  load: () => Promise<void>;
  /** 把当前窗口标签存为命名快照（name 留空则自动命名）。 */
  saveCurrentWindow: (name?: string) => Promise<void>;
  /** 把当前窗口标签存为轻量「工作区」快照（复用快照能力，OQ-3 最小版）。 */
  saveSpace: (name?: string) => Promise<void>;
  /** 归档当前窗口：留档并关闭全部标签，返回留档标签数（D7 第三种操作）。 */
  archiveCurrentWindow: (name?: string) => Promise<number>;
  /** 从 OneTab 导出文本导入为快照，返回导入标签数（D9.3 竞品迁移）。 */
  importOneTab: (text: string, name?: string) => Promise<number>;
  /** 删除指定快照。 */
  deleteSnapshot: (id: string) => Promise<void>;
  /** 重命名指定快照。 */
  renameSnapshot: (id: string, name: string) => Promise<void>;
  /** 恢复指定快照（在当前窗口重新打开全部标签），返回打开的标签数。 */
  restore: (id: string) => Promise<number>;
}

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshots: [],
  ready: false,

  load: async () => {
    const snapshots = await snapshotsRepository.read();
    set({ snapshots, ready: true });
    // 关窗自动保存由 background SW 直写仓库：面板打开期间需实时同步列表/角标。
    // 回显守卫：本页面自身写入触发的回放内容相同，直接跳过。
    snapshotsRepository.watch((value) => {
      if (JSON.stringify(value) === JSON.stringify(get().snapshots)) return;
      set({ snapshots: value });
    });
  },

  saveCurrentWindow: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const snapTabs = toSnapTabs(tabs);
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    const snapshot = buildSnapshot({ name: name ?? '', origin: 'manual', windowId: win?.id, tabs: snapTabs });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
  },

  saveSpace: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const snapTabs = toSnapTabs(tabs);
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    const snapshot = buildSnapshot({ name: name ?? '', origin: 'space', windowId: win?.id, tabs: snapTabs });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
  },

  archiveCurrentWindow: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const windowId = tabs[0]?.windowId;
    const snapTabs = toSnapTabs(tabs);
    if (snapTabs.length > 0) {
      const snapshot = buildSnapshot({ name: name ?? '', origin: 'archive', windowId, tabs: snapTabs });
      const next = await persistSnapshot(snapshot);
      set({ snapshots: next });
    }
    // 只关闭已留档的可恢复标签：chrome:// 等内部页无法入档，保留在原窗口（不静默丢失）。
    const closableIds = tabs
      .filter(
        (tab) => typeof tab.id === 'number' && tab.url && /^https?:\/\//i.test(tab.url)
      )
      .map((tab) => tab.id!);
    // 若关闭后窗口将随之关闭（全部标签都已留档），提前请求跳过本次关窗自动保存，
    // 避免 background 再写一条同内容的 auto 快照。
    if (windowId !== undefined && closableIds.length > 0 && closableIds.length === tabs.length) {
      const message = SkipAutoSaveOnceMessageSchema.parse({
        type: 'skip-auto-save-once',
        windowId
      });
      await browser.runtime.sendMessage(message).catch(() => {});
    }
    if (closableIds.length > 0) await browser.tabs.remove(closableIds).catch(() => undefined);
    return snapTabs.length;
  },

  importOneTab: async (text, name) => {
    const tabs = parseOneTab(text);
    if (tabs.length === 0) return 0;
    const snapshot = buildSnapshot({ name: name ?? 'OneTab 导入', origin: 'manual', windowId: undefined, tabs });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
    return tabs.length;
  },

  deleteSnapshot: async (id) => {
    // 读-改-写基于仓库最新值：面板打开期间 background 可能写入关窗自动快照，
    // 基于内存态全量回写会把它们覆盖丢失。
    const current = await snapshotsRepository.read();
    const next = current.filter((snap) => snap.id !== id);
    const ok = await snapshotsRepository.write(next);
    if (!ok) throw new Error('deleteSnapshot: storage write failed');
    set({ snapshots: next });
  },

  renameSnapshot: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = await snapshotsRepository.read();
    const next = current.map((snap) => (snap.id === id ? { ...snap, name: trimmed } : snap));
    const ok = await snapshotsRepository.write(next);
    if (!ok) throw new Error('renameSnapshot: storage write failed');
    set({ snapshots: next });
  },

  restore: async (id) => {
    const snap = get().snapshots.find((entry) => entry.id === id);
    if (!snap) return 0;
    return restoreSnapshot(snap);
  }
}));
