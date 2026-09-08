import { create } from 'zustand';
import { createUndoBatch, popBatch, pushBatch, toUndoTabRecord } from '@/core/undo/UndoStack';
import type { UndoBatch } from '@/core/schema/models';
import i18n from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import { settingsRepository, undoRepository } from '@/platform/storage/repositories';
import { restoreTabRecordsDetailed } from '@/platform/undo/RestoreEngine';
import { resolveRestoreWindowId } from '@/platform/tabs';
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
  /** 撤销进行中：UI 据此禁用入口，避免并发撤销。 */
  undoing: boolean;

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
/**
 * 撤销执行互斥。
 *
 * 恢复一个批次要为每个标签走一次 `tabs.create`（几十~几百 ms）。若期间允许再次撤销，
 * 第二次调用读到的仍是「未出栈」的同一批，同一批标签会被恢复两次 —— 撤销从安全网
 * 变成制造重复标签的来源。
 *
 * 锁在 `await` 之前同步置起，因此出栈是否提前都安全；出栈刻意**不**提前到恢复之前：
 * 「恢复成功才出栈」是本 store 的核心不变量，失败项要能重新入栈供用户重试。
 */
let undoInFlight = false;

/**
 * undoRepository 写盘串行链（追加顺序）。
 *
 * 撤销恢复耗时数百 ms，期间新批次仍可入栈（closeWithUndo 刻意不受
 * undoInFlight 拦截）。旧实现中 appendBatch 与撤销出栈各自基于自己的快照
 * 写盘，两条异步链的 `chrome.storage.set` 完成先后无保证 —— 磁盘终态可能
 * 是被「旧栈+新批」覆盖（已撤销批次重启后复活，可被再次撤销、重复恢复标签）。
 * 统一收口到本链，且写盘内容一律在链内执行时读取（makeData），消除读-写窗口。
 */
let undoPersistChain: Promise<void> = Promise.resolve();
/**
 * 入队一次撤销库写盘，返回该步骤完成的 promise（调用方按需等待）。
 *
 * 常规写入（入栈/撤销出栈）遵循 persistUndo 开关（关闭时不写库）；
 * 清库类写入（load 清历史库 / clearBatches 兜底）必须无条件执行：
 * 它们防的是「上一轮开启时留下的批次复活」，与开关无关。
 */
function enqueueUndoPersist(
  makeData: () => UndoBatch[],
  opts?: { alwaysWrite?: boolean }
): Promise<void> {
  const step = undoPersistChain.then(async () => {
    if (!opts?.alwaysWrite) {
      const settings = await settingsRepository.read();
      if (!settings.persistUndo) return;
    }
    const ok = await undoRepository.write(makeData());
    if (!ok) logFailure('undoStore', '撤销历史写入失败，本次撤销状态可能未持久化');
  });
  undoPersistChain = step.catch((error) => logFailure('undoStore', '撤销历史写入失败', error));
  return step;
}

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
   * 撤销执行体（undo / undoBatch 共用）。
   *
   * 关键语义：恢复成功才出栈。旧实现先出栈再恢复，一旦部分或全部恢复失败，
   * 该批次的撤销记录已经消失，用户既没拿回标签也失去了重试入口。
   * 现在：先恢复 → 按结果决定整批移除还是保留失败项（失败项重新入栈，可再次撤销）。
   *
   * 因此出栈由调用方经 `onCommitted` 回调执行，而**不是**在调用前乐观出栈：
   * 提前出栈会在「拿不到目标窗口」这类早退路径上把批次永久丢掉。
   */
  const runUndo = async (
    batch: UndoBatch,
    /**
     * 提交回调：恢复已发生后调用，参数为此刻的栈与需重试的批次。
     * 由调用方决定「如何移除该批次」，本函数只保证调用时机在恢复之后。
     */
    onCommitted: (currentStack: UndoBatch[], retryBatch: UndoBatch | undefined) => void
  ): Promise<void> => {
    // 回到当初关掉它的窗口；原窗口已关闭时退回当前聚焦窗口（归档场景常见）。
    const windowId = await resolveRestoreWindowId(batch.windowId);
    if (windowId === undefined) {
      // 无可用窗口时必须让用户知情：静默 return 会让「点了撤销什么都没发生」。
      // 注意：这里刻意不提交出栈——批次必须留在栈里，否则用户再也拿不回来。
      set({
        toast: {
          message: i18n.t('errors.operationFailed'),
          canUndo: false,
          batchId: undefined
        }
      });
      scheduleToastClear();
      return;
    }
    clearTimeout(toastTimer);
    set({ toast: null });

    const result = await restoreTabRecordsDetailed(batch.entries, windowId);
    const failedCount = result.failed.length;
    // 失败项保留为一个新批次（放回栈顶，位置最靠前，便于立刻重试）。
    const retryBatch = failedCount > 0 ? { ...batch, entries: result.failed } : undefined;
    // 出栈基于「此刻的栈」而非入口快照：恢复期间可能有新批次入栈（如同步关闭），
    // 用入口快照会把它们整批抹掉。
    onCommitted(get().batches, retryBatch);

    // 出栈后入队持久化：写盘内容在链内执行时读取最新内存栈，避免与
    // 恢复期间入栈的新批次产生「旧快照覆盖新数据」的交错（见 enqueueUndoPersist）。
    await enqueueUndoPersist(() => get().batches);

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
    // 入队持久化：链内执行时重读最新内存栈（可能已含后续批次或撤销出栈，
    // 保证磁盘终态与内存一致）；persistUndo 关闭时不写库（链内检查）。
    await enqueueUndoPersist(() => get().batches);
  };

  return {
    batches: [],
    toast: null,
    ready: false,
    undoing: false,

    load: async () => {
      const settings = await settingsRepository.read();
      const batches = settings.persistUndo ? await undoRepository.read() : [];
      if (!settings.persistUndo) await enqueueUndoPersist(() => [], { alwaysWrite: true });
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
        closed.map((tab) => toUndoTabRecord(tab, groupNameById)),
        { windowId: closed[0]?.windowId ?? useTabStore.getState().currentWindowId }
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
      if (undoInFlight) return;
      const [latest] = popBatch(get().batches);
      if (!latest) return;
      undoInFlight = true;
      set({ undoing: true });
      try {
        await runUndo(latest, (current, retryBatch) => {
          // 恢复已发生：此时才出栈（按 id 精确移除，不用 popBatch——恢复期间
          // 可能有新批次入栈，栈尾未必还是本批）。失败项放回栈顶保留重试入口。
          const remaining = current.filter((entry) => entry.id !== latest.id);
          set({ batches: retryBatch ? [retryBatch, ...remaining] : remaining });
        });
      } finally {
        undoInFlight = false;
        set({ undoing: false });
      }
    },

    undoBatch: async (batchId) => {
      if (undoInFlight) return;
      const batch = get().batches.find((entry) => entry.id === batchId);
      if (!batch) return;
      undoInFlight = true;
      set({ undoing: true });
      try {
        await runUndo(batch, (current, retryBatch) => {
          const remaining = current.filter((entry) => entry.id !== batchId);
          set({
            batches: retryBatch ? [retryBatch, ...remaining] : remaining
          });
        });
      } finally {
        undoInFlight = false;
        set({ undoing: false });
      }
    },

    recordClosedBatch: async (tabs, kind, groupNameById) => {
      if (tabs.length === 0) return;
      const batch = createUndoBatch(
        kind,
        tabs.map((tab) => toUndoTabRecord(tab, groupNameById ?? new Map())),
        { windowId: tabs[0]?.windowId }
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
      // 持久层通常已被 storage.local.clear 清空，此处入队写空数组兜底（并消除文件缺失歧义）。
      await enqueueUndoPersist(() => [], { alwaysWrite: true });
    }
  };
});
