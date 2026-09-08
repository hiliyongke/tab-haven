import { create } from 'zustand';
import { browser } from 'wxt/browser';
import i18n from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { queryCurrentWindowTabs } from '@/platform/tabs';
import { sendMessage } from '@/platform/messages';
import { snapshotsRepository } from '@/platform/storage/repositories';
import { logFailure } from '@/platform/diagnostics';
import { useUndoStore } from '@/stores/undoStore';
import {
  buildSnapshot,
  collectSnapshotTabs,
  parseOneTab,
  persistSnapshot,
  restoreSnapshot,
  SNAPSHOTS_RMW_LOCK
} from '@/platform/snapshot/snapshots';
import { withCrossPageLock } from '@/platform/storage/crossPageLock';
import { queryCurrentWindowGroups } from '@/platform/tabs';

/**
 * 快照 store：命名快照的读取、保存、恢复、删除、重命名，以及归档与 OneTab 导入。
 * 数据经 snapshotsRepository 落盘，store 仅持有内存态供 UI 渲染。
 */

interface SnapshotState {
  snapshots: Snapshot[];
  ready: boolean;

  /** 拉取快照列表（面板启动时调用）。 */
  load: () => Promise<void>;
  /** 把当前窗口标签存为命名快照（name 留空则自动命名）。 */
  saveCurrentWindow: (name?: string) => Promise<void>;
  /** 把当前窗口标签存为轻量「工作区」快照（复用快照能力，OQ-3 最小版）。 */
  saveSpace: (name?: string) => Promise<void>;
  /** 归档当前窗口：留档并关闭全部标签，返回留档标签数。 */
  archiveCurrentWindow: (name?: string) => Promise<number>;
  /** 从 OneTab 导出文本导入为快照，返回导入标签数。 */
  importOneTab: (text: string, name?: string) => Promise<number>;
  /** 删除指定快照。 */
  deleteSnapshot: (id: string) => Promise<void>;
  /** 重命名指定快照。 */
  renameSnapshot: (id: string, name: string) => Promise<void>;
  /** 恢复指定快照（在当前窗口重新打开全部标签），返回打开的标签数。 */
  restore: (id: string) => Promise<number>;
  /** 内存态重置（清除所有数据时调用：已删除的快照不应继续出现在列表里）。 */
  reset: () => void;
}

/** 仓库 watcher 注册守卫（load 可重入，监听器只注册一次）。 */
let watcherStarted = false;

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshots: [],
  ready: false,

  load: async () => {
    // 先注册 watcher 再 read：read 完成到 watch 注册之间的 background 写入
    // （关窗自动保存直写仓库）若无人接收，内存列表会一直少一条直到下次变更。
    // 守卫：load 会被 StrictMode 与多入口重复调用，每次都注册会让同一次仓库变更
    // 被回放 N 次（列表抖动 + 重复渲染）。
    if (!watcherStarted) {
      watcherStarted = true;
      // 回显守卫：本页面自身写入触发的回放内容相同，直接跳过。
      snapshotsRepository.watch((value) => {
        if (JSON.stringify(value) === JSON.stringify(get().snapshots)) return;
        set({ snapshots: value });
      });
    }
    const snapshots = await snapshotsRepository.read();
    set({ snapshots, ready: true });
  },

  saveCurrentWindow: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryCurrentWindowGroups(tabs[0]?.windowId);
    const snapTabs = collectSnapshotTabs(tabs, groups);
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: i18n.t('snapshots.defaultName'),
      origin: 'manual',
      windowId: win?.id,
      tabs: snapTabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
  },

  saveSpace: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryCurrentWindowGroups(tabs[0]?.windowId);
    const snapTabs = collectSnapshotTabs(tabs, groups);
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: i18n.t('snapshots.defaultSpaceName'),
      origin: 'space',
      windowId: win?.id,
      tabs: snapTabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
  },

  archiveCurrentWindow: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryCurrentWindowGroups(tabs[0]?.windowId);
    const windowId = tabs[0]?.windowId;
    const snapTabs = collectSnapshotTabs(tabs, groups);
    if (snapTabs.length > 0) {
      const snapshot = buildSnapshot({
        name: name ?? '',
        fallbackName: i18n.t('snapshots.defaultArchiveName'),
        origin: 'archive',
        windowId,
        tabs: snapTabs
      });
      try {
        const next = await persistSnapshot(snapshot);
        set({ snapshots: next });
      } catch (error) {
        // 留档失败绝不关闭标签：归档的语义是「留档 + 关闭」，
        // 只完成后者会变成一次不可撤销的丢标签事故。此处中止，标签保持打开。
        logFailure('snapshotStore', '归档留档失败，已中止关窗，标签保持打开', error);
        throw error;
      }
    }
    // 只关闭已留档的可恢复标签：chrome:// 等内部页无法入档，保留在原窗口（不静默丢失）。
    const closableIds = tabs
      .filter((tab) => typeof tab.id === 'number' && tab.url && /^https?:\/\//i.test(tab.url))
      .map((tab) => tab.id!);
    // 若关闭后窗口将随之关闭（全部标签都已留档），提前请求跳过本次关窗自动保存，
    // 避免 background 再写一条同内容的 auto 快照。
    if (windowId !== undefined && closableIds.length > 0 && closableIds.length === tabs.length) {
      sendMessage({ type: 'skip-auto-save-once', windowId });
    }
    if (closableIds.length > 0) {
      // 先登记撤销再关闭：归档也是一次「关闭动作」，关闭后必须存在可撤销入口，
      // 否则用户只能去归档列表翻找（关窗即失联，违背可信关闭原则）。
      const closing = tabs.filter(
        (tab) => typeof tab.id === 'number' && closableIds.includes(tab.id!)
      );
      const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
      await useUndoStore
        .getState()
        .recordClosedBatch(closing, 'archive', groupNameById)
        .catch((error) => {
          // 撤销登记失败不阻断归档（快照已经落盘，数据不会丢），但必须留痕。
          logFailure('snapshotStore', '归档撤销登记失败，本次归档仅能从快照恢复', error);
        });

      await browser.tabs.remove(closableIds).catch(() => undefined);
    }
    return snapTabs.length;
  },

  importOneTab: async (text, name) => {
    const tabs = parseOneTab(text);
    if (tabs.length === 0) return 0;
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: i18n.t('snapshots.oneTabImportName'),
      origin: 'manual',
      windowId: undefined,
      tabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
    return tabs.length;
  },

  deleteSnapshot: async (id) => {
    // 读-改-写基于仓库最新值 + 跨页锁串行化：面板打开期间 background 可能写入
    // 关窗自动快照，锁外 RMW 交错仍会把它们覆盖丢失（锁与 persistSnapshot 同一把）。
    const next = await withCrossPageLock(SNAPSHOTS_RMW_LOCK, async () => {
      const current = await snapshotsRepository.read();
      const updated = current.filter((snap) => snap.id !== id);
      const ok = await snapshotsRepository.write(updated);
      if (!ok) throw new Error('deleteSnapshot: storage write failed');
      return updated;
    });
    set({ snapshots: next });
  },

  renameSnapshot: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = await withCrossPageLock(SNAPSHOTS_RMW_LOCK, async () => {
      const current = await snapshotsRepository.read();
      const updated = current.map((snap) => (snap.id === id ? { ...snap, name: trimmed } : snap));
      const ok = await snapshotsRepository.write(updated);
      if (!ok) throw new Error('renameSnapshot: storage write failed');
      return updated;
    });
    set({ snapshots: next });
  },

  restore: async (id) => {
    const snap = get().snapshots.find((entry) => entry.id === id);
    if (!snap) return 0;
    return restoreSnapshot(snap);
  },

  reset: () => set({ snapshots: [], ready: false })
}));
