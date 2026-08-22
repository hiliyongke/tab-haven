import { create } from 'zustand';
import { createUndoBatch, popBatch, pushBatch, toUndoTabRecord } from '@/core/undo/UndoStack';
import type { UndoBatch } from '@/core/schema/models';
import { UndoBatchSchema } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { DataRepository } from '@/platform/storage/DataRepository';
import { restoreTabRecords } from '@/platform/undo/RestoreEngine';
import { useTabStore } from '@/stores/tabStore';

/**
 * 撤销 store（FR-D8.1）：批次入栈（含持久化）、撤销执行、状态提示。
 *
 * 编排入口 closeWithUndo：记录五元组 → 关闭 → 状态提示（可撤销）。
 */

const undoRepository = new DataRepository<UndoBatch[]>(
  'tabhaven.undo-stack.v1',
  UndoBatchSchema.array(),
  []
);

interface ToastState {
  message: string;
  canUndo: boolean;
  batchId: string | undefined;
}

interface UndoState {
  batches: UndoBatch[];
  toast: ToastState | null;
  ready: boolean;

  load: () => Promise<void>;
  /** 统一关闭入口：记录 + 执行 + 提示。 */
  closeWithUndo: (tabs: readonly TabRecord[], tabIds: readonly number[]) => Promise<void>;
  undo: () => Promise<void>;
  clearToast: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUndoStore = create<UndoState>()((set, get) => ({
  batches: [],
  toast: null,
  ready: false,

  load: async () => {
    const batches = await undoRepository.read();
    set({ batches, ready: true });
  },

  closeWithUndo: async (tabs, tabIds) => {
    const idSet = new Set(tabIds);
    const closing = tabs.filter((tab) => idSet.has(tab.id));
    if (closing.length === 0) return;

    const groups = useTabStore.getState().groups;
    const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
    const batch = createUndoBatch(
      'close',
      closing.map((tab) => toUndoTabRecord(tab, groupNameById))
    );

    const next = pushBatch(get().batches, batch);
    set({ batches: next });
    await undoRepository.write(next);

    await useTabStore.getState().closeTabs(closing.map((tab) => tab.id));

    set({
      toast: {
        message: `已关闭 ${closing.length} 个标签`,
        canUndo: true,
        batchId: batch.id
      }
    });
    scheduleToastClear();
  },

  undo: async () => {
    const [latest, remaining] = popBatch(get().batches);
    if (!latest) return;

    set({ batches: remaining });
    await undoRepository.write(remaining);
    clearTimeout(toastTimer);
    set({ toast: null });

    const windowId = useTabStore.getState().currentWindowId;
    if (windowId === undefined) return;
    const count = await restoreTabRecords(latest.entries, windowId);
    set({ toast: { message: `已恢复 ${count} 个标签`, canUndo: false, batchId: undefined } });
    scheduleToastClear();
  },

  clearToast: () => {
    clearTimeout(toastTimer);
    set({ toast: null });
  }
}));

function scheduleToastClear(): void {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    useUndoStore.setState({ toast: null });
  }, 7_000);
}
