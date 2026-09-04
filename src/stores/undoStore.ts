import { create } from 'zustand';
import { createUndoBatch, popBatch, pushBatch, toUndoTabRecord } from '@/core/undo/UndoStack';
import type { UndoBatch } from '@/core/schema/models';
import i18n from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import { settingsRepository, undoRepository } from '@/platform/storage/repositories';
import { restoreTabRecordsDetailed } from '@/platform/undo/RestoreEngine';
import { logFailure } from '@/platform/diagnostics';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';

/**
 * 撤销 store：批次入栈（含持久化）、撤销执行、状态提示。
 * 编排入口 closeWithUndo：记录五元组 → 关闭 → 状态提示。
 */

/** toast 上的自定义动作（如「唤醒全部休眠标签」）。 */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface ToastState {
  message: string;
  canUndo: boolean;
  batchId: string | undefined;
  /** 自定义动作按钮（自动休眠撤销等非关闭类操作）。 */
  action?: ToastAction;
}

interface UndoState {
  batches: UndoBatch[];
  toast: ToastState | null;
  ready: boolean;

  load: () => Promise<void>;
  /** 统一关闭入口：记录 + 执行 + 提示。 */
  closeWithUndo: (tabs: readonly TabRecord[], tabIds: readonly number[]) => Promise<void>;
  /** 撤销最近一步。 */
  undo: () => Promise<void>;
  /** 撤销指定批次（撤销历史面板用）。 */
  undoBatch: (batchId: string) => Promise<void>;
  /**
   * 外部关闭路径登记撤销（如窗口归档）。
   * 归档此前不进撤销栈：标签已关闭却无处可撤，恢复只能靠快照列表，违背「可信关闭」。
   */
  recordClosedBatch: (
    tabs: readonly TabRecord[],
    kind: string,
    groupNameById?: ReadonlyMap<number, string | undefined>
  ) => Promise<void>;
  clearToast: () => void;
  /** 通用状态提示（无可撤销动作），如后台自动合并通知；可携带自定义动作。 */
  notify: (message: string, action?: ToastAction) => void;
  /** 清空撤销栈（内存 + 持久化）。清除所有数据时调用——被清除的数据不参与撤销。 */
  clearBatches: () => Promise<void>;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUndoStore = create<UndoState>()((set, get) => {
  const scheduleToastClear = (): void => {
    clearTimeout(toastTimer);
    // 提示条显示时长来自设置（默认 7 秒），不再硬编码。
    const durationSec = useDataStore.getState().settings.toastDurationSec;
    toastTimer = setTimeout(() => {
      set({ toast: null });
    }, durationSec * 1000);
  };

  /**
   * 撤销执行体（undo / undoBatch 共用）：出栈结果由调用方算好传入。
   *
   * 关键语义：恢复成功才提交。旧实现先出栈再恢复，一旦部分或全部恢复失败，
   * 该批次的撤销记录已经消失，用户既没拿回标签也失去了重试入口。
   * 现在：先恢复 → 按结果决定整批移除还是保留失败项（失败项重新入栈，可再次撤销）。
   */
  const runUndo = async (batch: UndoBatch, remaining: UndoBatch[]): Promise<void> => {
    const windowId = useTabStore.getState().currentWindowId;
    if (windowId === undefined) return;
    clearTimeout(toastTimer);
    set({ toast: null });

    const result = await restoreTabRecordsDetailed(batch.entries, windowId);
    const failedCount = result.failed.length;

    // 失败项保留为一个新批次（放回栈顶，位置最靠前，便于立刻重试）。
    const nextBatches =
      failedCount > 0 ? [{ ...batch, entries: result.failed }, ...remaining] : remaining;

    set({ batches: nextBatches });
    const settings = await settingsRepository.read();
    if (settings.persistUndo) {
      const ok = await undoRepository.write(nextBatches);
      if (!ok) logFailure('undoStore', '撤销历史写入失败，本次撤销状态可能未持久化');
    }

    set({
      toast: {
        message:
          failedCount > 0
            ? i18n.t('undo.restoredPartial', { count: result.count, failed: failedCount })
            : i18n.t('undo.restored', { count: result.count }),
        canUndo: false,
        batchId: undefined
      }
    });
    scheduleToastClear();
  };

  /** 入栈并持久化（closeWithUndo 与 recordClosedBatch 共用）。 */
  const appendBatch = async (batch: UndoBatch): Promise<void> => {
    const settings = await settingsRepository.read();
    const next = pushBatch(get().batches, batch, settings.undoStackLimit);
    set({ batches: next });
    // persistUndo 关闭时不写库：load() 已清过历史库，会话内批次仅存活于内存。
    if (settings.persistUndo) {
      const ok = await undoRepository.write(next);
      if (!ok) logFailure('undoStore', '撤销历史写入失败，该批次可能未持久化');
    }
  };

  return {
    batches: [],
    toast: null,
    ready: false,

    load: async () => {
      const settings = await settingsRepository.read();
      const batches = settings.persistUndo ? await undoRepository.read() : [];
      if (!settings.persistUndo) await undoRepository.write([]);
      set({ batches, ready: true });
    },

    closeWithUndo: async (tabs, tabIds) => {
      const idSet = new Set(tabIds);
      const requested = tabs.filter((tab) => idSet.has(tab.id));
      const closing = requested.filter((tab) => !tab.pinned);
      if (closing.length === 0) {
        if (requested.length > 0) {
          set({
            toast: {
              message: i18n.t('undo.closedSkipped', { count: requested.length }),
              canUndo: false,
              batchId: undefined
            }
          });
          scheduleToastClear();
        }
        return;
      }

      const closedIds = await useTabStore.getState().closeTabs(closing.map((tab) => tab.id));
      const closedIdSet = new Set(closedIds);
      const closed = closing.filter((tab) => closedIdSet.has(tab.id));
      if (closed.length === 0) {
        set({
          toast: {
            message: i18n.t('undo.closedSkipped', { count: requested.length }),
            canUndo: false,
            batchId: undefined
          }
        });
        scheduleToastClear();
        return;
      }

      const groups = useTabStore.getState().groups;
      const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
      const batch = createUndoBatch(
        'close',
        closed.map((tab) => toUndoTabRecord(tab, groupNameById))
      );

      await appendBatch(batch);

      const skipped = requested.length - closed.length;
      set({
        toast: {
          message:
            skipped > 0
              ? i18n.t('undo.closedPartial', { count: closed.length, skipped })
              : i18n.t('undo.closed', { count: closed.length }),
          canUndo: true,
          batchId: batch.id
        }
      });
      scheduleToastClear();
    },

    undo: async () => {
      const [latest, remaining] = popBatch(get().batches);
      if (!latest) return;
      await runUndo(latest, remaining);
    },

    undoBatch: async (batchId) => {
      const batch = get().batches.find((entry) => entry.id === batchId);
      if (!batch) return;
      await runUndo(
        batch,
        get().batches.filter((entry) => entry.id !== batchId)
      );
    },

    recordClosedBatch: async (tabs, kind, groupNameById) => {
      if (tabs.length === 0) return;
      const batch = createUndoBatch(
        kind,
        tabs.map((tab) => toUndoTabRecord(tab, groupNameById ?? new Map()))
      );
      await appendBatch(batch);
    },

    clearToast: () => {
      clearTimeout(toastTimer);
      set({ toast: null });
    },

    notify: (message, action) => {
      set({ toast: { message, canUndo: false, batchId: undefined, action } });
      scheduleToastClear();
    },

    clearBatches: async () => {
      clearTimeout(toastTimer);
      set({ batches: [], toast: null });
      // 持久层通常已被 storage.local.clear 清空，此处写空数组兜底（并消除文件缺失歧义）。
      const ok = await undoRepository.write([]);
      if (!ok) logFailure('undoStore', '撤销历史清空失败');
    }
  };
});
