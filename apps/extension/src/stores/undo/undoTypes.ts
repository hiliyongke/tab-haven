import type { UndoBatch, UndoTabRecord } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';

/** toast 上的自定义动作（如「唤醒全部休眠标签」）。 */
interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastState {
  message: string;
  canUndo: boolean;
  batchId: string | undefined;
  /** 自定义动作按钮（自动休眠撤销等非关闭类操作）。 */
  action?: ToastAction;
  /** 回执的补充说明；淘汰告知与写盘失败在此同槽展示，避免被后续回执顶掉。 */
  note?: string;
  /** error 用 role="alert" 立即播报，info 用 role="status" 排队播报。 */
  tone?: 'info' | 'error';
}

export interface UndoState {
  batches: UndoBatch[];
  /** 撤销成功后记录实际恢复的条目；任何新关闭批次入栈即清空。 */
  redoBatches: UndoBatch[];
  toast: ToastState | null;
  ready: boolean;
  /** 撤销进行中：UI 据此禁用入口，避免并发撤销。 */
  undoing: boolean;
  /** 重做进行中（与撤销共用执行互斥）。 */
  redoing: boolean;

  load: () => Promise<void>;
  /** 统一关闭入口：记录 + 执行 + 提示；仅本次实际新建批次时返回其 id。 */
  closeWithUndo: (
    tabs: readonly TabRecord[],
    tabIds: readonly number[]
  ) => Promise<string | undefined>;
  /** 撤销最近一个批次（整批回退，不是逐个标签）。 */
  undo: () => Promise<void>;
  /** 撤销指定批次（撤销历史面板用）。 */
  undoBatch: (batchId: string) => Promise<void>;
  /** 再次关闭刚恢复的标签；关闭结果重新入撤销栈，可再次撤销。 */
  redo: () => Promise<void>;
  /** 登记归档等外部关闭路径，保证这些标签同样可撤销。 */
  recordClosedBatch: (
    tabs: readonly TabRecord[],
    kind: string,
    groupNameById?: ReadonlyMap<number, string | undefined>
  ) => Promise<void>;
  /** 登记快照恢复真实创建的标签，撤销时按 id 精准关闭。 */
  recordRestoreBatch: (createdTabs: readonly TabRecord[], windowId?: number) => Promise<void>;
  /** 登记 SW 复用引擎关闭的标签；面板拿不到快照，由 SW 回传记录。 */
  recordReuseClosed: (
    windowId: number,
    records: readonly UndoTabRecord[],
    batchId?: string
  ) => Promise<boolean>;
  clearToast: () => void;
  /** 通用状态提示（无可撤销动作），如后台自动合并通知；可携带自定义动作。 */
  notify: (message: string, action?: ToastAction) => void;
  /** 无异常对象的业务失败（布尔失败或校验失败）走此入口。 */
  notifyError: (message: string) => void;
  /** 有 error 的失败统一走此入口：用户提示与诊断留痕同时保留。 */
  notifyFailure: (scope: string, message: string, error: unknown) => void;
  /** 淘汰提示按 key 在本会话内只展示一次，避免连续淘汰刷屏。 */
  notifyEviction: (key: string, message: string) => void;
  /** 清空撤销栈（内存 + 持久化）。清除所有数据时调用——被清除的数据不参与撤销。 */
  clearBatches: () => Promise<void>;
}

/**
 * 双栈落盘结果。redo 先写：它失败时 undo 不得再写；undo 失败时保留已写入的 redo，
 * 让内存回到「原撤销批次 + 新重做批次」这一与磁盘一致、且不丢失恢复出口的安全态。
 */
export type UndoRedoPersistResult = 'both' | 'none' | 'redo-only';
