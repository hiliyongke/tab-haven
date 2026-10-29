import { create } from 'zustand';
import { translate } from '@/i18n';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { structuralSignature } from '@/core/util/signature';
import {
  closeTabs,
  queryCurrentWindowTabs,
  queryWindowGroups,
  queryWindowTabs,
  resolveRestoreWindowId
} from '@/platform/tabs';
import { sendMessageWithAck } from '@/platform/messages';
import { snapshotsRepository } from '@/platform/storage/repositories';
import { logDegraded, logFailure } from '@/platform/diagnostics';
import { useUndoStore } from '@/stores/undoStore';
import type { RestoreSnapshotResult } from '@/platform/snapshot/snapshots';
import {
  buildSnapshot,
  collectSnapshotTabs,
  persistSnapshot,
  replaceSpaceSnapshot,
  restoreSnapshot,
  setSnapshotEvictionListener
} from '@/platform/snapshot/snapshots';
import { parseWorkona } from '@/core/insights/workonaImport';
import { newId } from '@/core/util/id';
import { buildPartialSnapshot } from '@/core/snapshot/snapshotDiff';
import { parseOneTab } from '@/core/snapshot/oneTabImport';
import { isHttpUrl } from '@/core/url/UrlInspector';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';
import { SNAPSHOTS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';

/** 把恢复新建的标签记为可撤销项：用前后差分（恢复后多出的 tabId），避免误把原有标签当恢复产物。 */
async function recordRestoreForUndo(
  beforeIds: ReadonlySet<number>,
  windowId: number
): Promise<void> {
  try {
    const after = await queryWindowTabs(windowId);
    const created = after.filter((tab) => !beforeIds.has(tab.id));
    if (created.length === 0) return;
    await useUndoStore.getState().recordClosedBatch(created, 'restore');
  } catch (error) {
    // 记录失败不影响恢复结果本身，但必须留痕。
    logFailure('snapshotStore', '快照恢复的撤销登记失败，本次恢复无法一键撤销', error);
  }
}

/** 捕获恢复前现场（差分基线）。读不到就返回 undefined 不记账：那等于把用户原有标签当恢复产物，撤销会误关。 */
async function captureWindowTabIds(
  windowId: number | undefined
): Promise<ReadonlySet<number> | undefined> {
  if (windowId === undefined) return undefined;
  return queryWindowTabs(windowId)
    .then((tabs) => new Set(tabs.map((tab) => tab.id)))
    .catch((error: unknown) => {
      logDegraded('snapshotStore', `窗口 ${windowId} 恢复前现场读取失败，本次不登记撤销`, error);
      return undefined;
    });
}

/** 注册淘汰提示：快照超限移除最旧的，经 notifyEviction 合并（连续导入 Workona 会连续淘汰，逐次提示会刷屏）。 */
setSnapshotEvictionListener((count) => {
  useUndoStore.getState().notifyEviction(
    'snapshots',
    translate('快照已达上限，最早的 {{count}} 份已被移除（可在设置中调整快照保留数量）', {
      count
    })
  );
});

/** 快照 store：命名快照的读取、保存、恢复、删除、重命名，以及归档与 OneTab/Workona 导入。 */

interface SnapshotState {
  snapshots: Snapshot[];
  ready: boolean;

  /** 拉取快照列表（面板启动时调用）。 */
  load: () => Promise<void>;
  /** 存当前窗口为命名快照。返回是否落盘：空现场返回 false（失败原因由 notifyError 承载）。 */
  saveCurrentWindow: (name?: string) => Promise<boolean>;
  /** 存当前窗口为轻量工作区快照。返回值同 saveCurrentWindow。 */
  saveSpace: (name?: string) => Promise<boolean>;
  /** 归档当前窗口：保存并关闭全部标签，返回保存标签数。 */
  archiveCurrentWindow: (name?: string) => Promise<number>;
  /** 从 OneTab 文本导入为快照；truncated 表示有效条目超过上限、超出部分被丢弃。 */
  importOneTab: (text: string, name?: string) => Promise<{ count: number; truncated: boolean }>;
  /** 从 Workona JSON 批量导入快照族，返回 { 快照数, 标签数, 跳过数, 截断量, 失败原因 }。 */
  importWorkona: (text: string) => Promise<{
    snapshots: number;
    tabs: number;
    skipped: number;
    truncatedTabs: number;
    truncatedSnapshots: number;
    reason: 'ok' | 'too-large' | 'invalid-json' | 'unrecognized';
  }>;
  deleteSnapshot: (id: string) => Promise<void>;
  renameSnapshot: (id: string, name: string) => Promise<void>;
  /** 恢复快照。快照不存在时抛错（不返回成功形状，避免把「没执行」说成「恢复 0 个」）。 */
  restore: (id: string, windowId?: number) => Promise<RestoreSnapshotResult>;
  /** 把当前窗口最新现场写回既有空间快照（原地更新）。返回是否写入成功。 */
  updateSpace: (id: string) => Promise<boolean>;
  /** 选择性恢复：空勾选返回 0；快照不存在抛错。语义同 restore。 */
  restoreSelected: (
    id: string,
    selectedTabs: readonly SnapshotTab[]
  ) => Promise<RestoreSnapshotResult>;
  /** 内存态重置（清除所有数据时调用）。 */
  reset: () => void;
}

/** 仓库 watcher 注册守卫（load 可重入，监听器只注册一次）。 */
let watcherStarted = false;
/** 在途 load 的共享 promise：StrictMode 双挂载/多入口并发只发起一次全量读盘。 */
let loadInFlight: Promise<void> | null = null;
/** watcher 退订函数：仅在 HMR 重载时统一执行，防旧实例监听器把旧列表写回新实例。 */
const watcherUnsubscribers: Array<() => void> = [];

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshots: [],
  ready: false,

  load: async () => {
    loadInFlight ??= (async () => {
      // 先注册 watcher 再 read：read 完成到注册之间的 background 写入需有人接收。
      if (!watcherStarted) {
        watcherStarted = true;
        watcherUnsubscribers.push(
          snapshotsRepository.watch((value) => {
            // 回显守卫：structuralSignature 跳过 favIconUrl，避免大标签量下每次变更全量序列化两遍。
            if (structuralSignature(value) === structuralSignature(get().snapshots)) return;
            set({ snapshots: value });
          })
        );
      }
      const before = get().snapshots;
      const snapshots = await snapshotsRepository.read();
      // read 在途期间 watcher 已回放新值（引用变化）时以内存为准，不覆盖回旧值。
      if (get().snapshots !== before) {
        set({ ready: true });
        return;
      }
      set({ snapshots, ready: true });
    })().finally(() => {
      loadInFlight = null;
    });
    await loadInFlight;
  },

  saveCurrentWindow: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryWindowGroups(tabs[0]?.windowId);
    const snapTabs = collectSnapshotTabs(tabs, groups);
    // 空现场不落盘：tabCount=0 的快照不可恢复又占名额，须给可见回执。
    if (snapTabs.length === 0) {
      useUndoStore.getState().notifyError(translate('没有可保存的当前标签'));
      return false;
    }
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: DEFAULT_SNAPSHOT_NAMES.manual,
      origin: 'manual',
      // windowId 取实际采集窗口：getLastFocused 在多窗口场景可能指向另一窗口。
      windowId: tabs[0]?.windowId,
      tabs: snapTabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
    return true;
  },

  saveSpace: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryWindowGroups(tabs[0]?.windowId);
    const snapTabs = collectSnapshotTabs(tabs, groups);
    // 同 saveCurrentWindow：空工作区不落盘（换过去等于清空窗口且无从恢复）。
    if (snapTabs.length === 0) {
      useUndoStore.getState().notifyError(translate('没有可保存的当前标签'));
      return false;
    }
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: DEFAULT_SNAPSHOT_NAMES.space,
      origin: 'space',
      windowId: tabs[0]?.windowId,
      tabs: snapTabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
    return true;
  },

  archiveCurrentWindow: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryWindowGroups(tabs[0]?.windowId);
    const windowId = tabs[0]?.windowId;
    const snapTabs = collectSnapshotTabs(tabs, groups);
    if (snapTabs.length > 0) {
      const snapshot = buildSnapshot({
        name: name ?? '',
        fallbackName: DEFAULT_SNAPSHOT_NAMES.archive,
        origin: 'archive',
        windowId,
        tabs: snapTabs
      });
      try {
        const next = await persistSnapshot(snapshot);
        set({ snapshots: next });
      } catch (error) {
        // 保存失败绝不关闭标签：归档是「保存 + 关闭」，只完成后者会变成不可撤销的丢标签事故。
        logFailure('snapshotStore', '归档保存失败，已中止关窗，标签保持打开', error);
        throw error;
      }
    }
    // 只关闭已保存的可恢复标签（http(s)）；内部页保留在原窗口。
    const closableIds = tabs.flatMap((tab) =>
      typeof tab.id === 'number' && isHttpUrl(tab.url) ? [tab.id] : []
    );
    // 全部标签已保存（关窗）时提前请求跳过本次关窗自动保存，避免再写一条同内容 auto 快照。必须 ack。
    if (windowId !== undefined && closableIds.length > 0 && closableIds.length === tabs.length) {
      await sendMessageWithAck({ type: 'skip-auto-save-once', windowId });
    }
    if (closableIds.length > 0) {
      // 先关闭拿到实际成功 id，再按真实结果登记撤销，避免把从未关闭的标签再开一份。
      const closedIds = await closeTabs(closableIds);
      const closing = tabs.filter(
        (tab) => typeof tab.id === 'number' && closedIds.includes(tab.id)
      );
      if (closing.length > 0) {
        const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
        await useUndoStore
          .getState()
          .recordClosedBatch(closing, 'archive', groupNameById)
          .catch((error) => {
            // 撤销登记失败不阻断归档（快照已落盘），但必须留痕。
            logFailure('snapshotStore', '归档撤销登记失败，本次归档仅能从快照恢复', error);
          });
      }
    }
    return snapTabs.length;
  },

  importOneTab: async (text, name) => {
    const { tabs, truncated } = parseOneTab(text);
    if (tabs.length === 0) return { count: 0, truncated: false };
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: DEFAULT_SNAPSHOT_NAMES.oneTab,
      origin: 'manual',
      windowId: undefined,
      tabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
    return { count: tabs.length, truncated };
  },

  importWorkona: async (text) => {
    const result = parseWorkona(text, () => newId('snap'));
    if (result.reason !== 'ok' || result.snapshots.length === 0) {
      return {
        snapshots: 0,
        tabs: 0,
        skipped: result.skippedWorkspaces,
        truncatedTabs: 0,
        truncatedSnapshots: result.truncatedSnapshots,
        reason: result.reason
      };
    }
    // 逐份落盘：每份都经 persistSnapshot 的裁剪语义收敛，与逐条手动保存的最终态一致。
    let latest: Snapshot[] | undefined;
    for (const snapshot of result.snapshots) {
      latest = await persistSnapshot(snapshot);
    }
    if (latest) set({ snapshots: latest });
    return {
      snapshots: result.snapshots.length,
      tabs: result.totalTabs,
      skipped: result.skippedWorkspaces,
      truncatedTabs: result.truncatedTabs,
      truncatedSnapshots: result.truncatedSnapshots,
      reason: result.reason
    };
  },

  deleteSnapshot: async (id) => {
    // 锁内 RMW：面板打开期间 background 可能写入关窗快照，锁外会覆盖丢失。
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
    if (!trimmed) {
      logDegraded('snapshotStore', '重命名快照收到空名称，已忽略');
      return;
    }
    const next = await withCrossPageLock(SNAPSHOTS_RMW_LOCK, async () => {
      const current = await snapshotsRepository.read();
      const updated = current.map((snap) => (snap.id === id ? { ...snap, name: trimmed } : snap));
      const ok = await snapshotsRepository.write(updated);
      if (!ok) throw new Error('renameSnapshot: storage write failed');
      return updated;
    });
    set({ snapshots: next });
  },

  /**
   * 恢复快照：把本次新建的标签记为可关闭批次（kind='restore'），由 undoStore 的 restore
   * 分支关闭它们实现「撤销本次恢复」。差分取目标窗口，避免跨窗恢复时匹配不到新建项。
   */
  restore: async (id, windowId) => {
    const snap = get().snapshots.find((entry) => entry.id === id);
    if (!snap) {
      // 找不到快照不能返回成功形状（会把「没执行」说成「恢复 0 个」）。抛出由调用方失败出口接管。
      logDegraded('snapshotStore', `快照 ${id} 不存在，恢复未执行`);
      throw new Error(`snapshot-not-found:${id}`);
    }
    const targetWindowId = await resolveRestoreWindowId(windowId);
    const beforeIds = await captureWindowTabIds(targetWindowId);
    const result = await restoreSnapshot(snap, windowId);
    if (result.count > 0 && beforeIds && targetWindowId !== undefined) {
      await recordRestoreForUndo(beforeIds, targetWindowId);
    }
    return result;
  },

  updateSpace: async (id) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryWindowGroups(tabs[0]?.windowId);
    const snapTabs = collectSnapshotTabs(tabs, groups);
    const result = await replaceSpaceSnapshot(id, snapTabs, tabs[0]?.windowId);
    set({ snapshots: result.snapshots });
    // false = 空间已不存在或现场为空（未覆盖），调用方据此决定后续步骤。
    return result.replaced;
  },

  restoreSelected: async (id, selectedTabs) => {
    const snap = get().snapshots.find((entry) => entry.id === id);
    if (!snap) {
      logDegraded('snapshotStore', `快照 ${id} 不存在，选择性恢复未执行`);
      throw new Error(`snapshot-not-found:${id}`);
    }
    // 空勾选不是失败：返回 0 即「本次没有新建任何标签」的真实结果。
    if (selectedTabs.length === 0) return { count: 0, degraded: false };
    // 撤销账本与整份恢复同口径：勾选恢复同样登记可撤销批次。
    const targetWindowId = await resolveRestoreWindowId(undefined);
    const beforeIds = await captureWindowTabIds(targetWindowId);
    const result = await restoreSnapshot(buildPartialSnapshot(snap, selectedTabs));
    if (result.count > 0 && beforeIds && targetWindowId !== undefined) {
      await recordRestoreForUndo(beforeIds, targetWindowId);
    }
    return result;
  },

  reset: () => set({ snapshots: [], ready: false })
}));

// HMR 重载时退订 watcher：模块级守卫随重载重置，旧监听器会把旧列表写回新实例。
import.meta.hot?.dispose(() => {
  for (const unsubscribe of watcherUnsubscribers) unsubscribe();
  watcherUnsubscribers.length = 0;
  watcherStarted = false;
});
