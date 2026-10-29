import { create } from 'zustand';
import {
  createUndoBatch,
  popBatch,
  pushBatch,
  pushBatchWithEvicted,
  selectRedoTargets,
  toUndoTabRecord
} from '@/core/undo/UndoStack';
import type { UndoBatch, UndoTabRecord } from '@/core/schema/models';
import { structuralSignature } from '@/core/util/signature';
import { createSerialChain, type SerialChain } from '@/core/util/concurrency';
import { translate } from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import {
  redoRepository,
  settingsRepository,
  undoRepository
} from '@/platform/storage/repositories';
import {
  UNDO_EXEC_LOCK,
  UNDO_PERSIST_LOCK,
  withCrossPageLock
} from '@/platform/storage/crossPageLock';
import { restoreTabRecordsDetailed } from '@/platform/undo/RestoreEngine';
import { queryWindowGroups, queryWindowTabs, resolveRestoreWindowId } from '@/platform/tabs';
import { logDegraded, logFailure } from '@/platform/diagnostics';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';

/**
 * 撤销 store：批次入栈（含持久化）、撤销执行、状态提示。
 * 编排入口 closeWithUndo：记录五元组 → 关闭 → 状态提示。
 */

/** toast 上的自定义动作（如「唤醒全部休眠标签」）。 */
interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface ToastState {
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

interface UndoState {
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
  /** 统一关闭入口：记录 + 执行 + 提示。 */
  closeWithUndo: (tabs: readonly TabRecord[], tabIds: readonly number[]) => Promise<void>;
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
  /** 登记 SW 复用引擎关闭的标签；面板拿不到快照，由 SW 回传记录。 */
  recordReuseClosed: (windowId: number, records: readonly UndoTabRecord[]) => Promise<void>;
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

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** 模块级会话记录，避免 store 重置误清「已提示」状态。 */
const notifiedEvictions = new Set<string>();
/** 等待后续回执接走的淘汰告知；队列保留同次操作中的多类淘汰。 */
const pendingEvictionToasts: string[] = [];
/** 写盘失败后由下一次回执展示并清空。 */
let undoPersistFailed = false;
/** 并发 load 共享同一次读取，完成后清空以允许重新读盘。 */
let loadInFlight: Promise<void> | null = null;
/** 仓库 watcher 注册守卫（跨页撤销栈同步，只注册一次）。 */
let undoWatcherStarted = false;
/** 重做栈独立注册一个 watcher。 */
let redoWatcherStarted = false;
/** HMR 时退订旧模块的 watcher，避免旧 store 回写新实例。 */
const watcherUnsubscribers: Array<() => void> = [];

/** 撤销栈写盘串行链；锁内以磁盘为基线叠加本页意图，避免异步整表覆盖。 */
const undoPersistChain = createSerialChain();
/** 重做栈独立串行链；与撤销栈共用 UNDO_PERSIST_LOCK。 */
const redoPersistChain = createSerialChain();

/**
 * 入队撤销/重做写盘。`apply` 在锁内基于最新磁盘栈计算终态，避免跨页整表覆盖。
 * 常规写入受 persistUndo 控制，清库写入必须执行；返回已兜底的 promise，避免面板销毁导致 ready 卡死。
 */
function enqueuePersist(
  chain: SerialChain,
  repo: typeof undoRepository,
  apply: (disk: UndoBatch[]) => UndoBatch[],
  opts: { alwaysWrite?: boolean } | undefined,
  notPersistedMessage: string,
  exceptionMessage: string
): Promise<void> {
  return chain.enqueueSettled(
    async () => {
      if (!opts?.alwaysWrite) {
        const settings = await settingsRepository.read();
        // 撤销栈与重做栈同开关：关闭「撤销记录跨重启持久化」时，重做也仅会话内有效。
        if (!settings.persistUndo) return;
      }
      await withCrossPageLock(UNDO_PERSIST_LOCK, async () => {
        const disk = await repo.read();
        const ok = await repo.write(apply(disk));
        if (!ok) {
          logFailure('undoStore', notPersistedMessage);
          // 置起可见标记：回执说「可撤销」而磁盘上其实没有这条记录，重启后撤销
          // 入口凭空消失 —— 只进诊断日志等于用户完全不知情（诊断要主动导出才看得到）。
          undoPersistFailed = true;
        }
      });
    },
    (error) => logFailure('undoStore', exceptionMessage, error)
  );
}

/* @i18n-ignore-start
 * 本块中文仅供诊断日志，不经界面展示。 */
/** 撤销栈写盘（见 enqueuePersist）。 */
function enqueueUndoPersist(
  apply: (disk: UndoBatch[]) => UndoBatch[],
  opts?: { alwaysWrite?: boolean }
): Promise<void> {
  return enqueuePersist(
    undoPersistChain,
    undoRepository,
    apply,
    opts,
    '撤销历史写入失败，本次撤销状态可能未持久化',
    '撤销历史写入失败'
  );
}

/** 重做栈写盘（见 enqueuePersist）。 */
function enqueueRedoPersist(
  apply: (disk: UndoBatch[]) => UndoBatch[],
  opts?: { alwaysWrite?: boolean }
): Promise<void> {
  return enqueuePersist(
    redoPersistChain,
    redoRepository,
    apply,
    opts,
    '重做栈写入失败，本次重做状态可能未持久化',
    '重做栈写入失败'
  );
}

/**
 * 撤销/重做双栈在同一跨页锁内同写；先写 redo 再写 undo，失败时整体回退内存态。
 * persistUndo 关闭时不写盘并视为成功。
 */
function enqueueUndoRedoPersist(
  redoApply: ((disk: UndoBatch[]) => UndoBatch[]) | undefined,
  undoApply: (disk: UndoBatch[]) => UndoBatch[]
): Promise<boolean> {
  return undoPersistChain
    .enqueue(async () => {
      const settings = await settingsRepository.read();
      if (!settings.persistUndo) return true;
      let ok = true;
      await withCrossPageLock(UNDO_PERSIST_LOCK, async () => {
        // 写盘内容一律在锁内以「磁盘基线 + 本页意图」计算（与 enqueuePersist 同口径）。
        if (redoApply) {
          const redoOk = await redoRepository.write(redoApply(await redoRepository.read()));
          if (!redoOk) {
            logFailure('undoStore', '重做栈写入失败，本次重做状态可能未持久化');
            ok = false;
          }
        }
        const undoOk = await undoRepository.write(undoApply(await undoRepository.read()));
        if (!undoOk) {
          logFailure('undoStore', '撤销历史写入失败，本次撤销状态可能未持久化');
          ok = false;
        }
      });
      return ok;
    })
    .catch((error: unknown) => {
      // 锁请求在上下文销毁时以 AbortError reject：不接住会让调用方拿到 rejection，
      // 撤销流程中断在「标签已恢复、状态未记账」的半途。
      logFailure('undoStore', '撤销/重做栈同写失败', error);
      return false;
    });
}
/* @i18n-ignore-end */

export const useUndoStore = create<UndoState>()((set, get) => {
  /** 页内执行互斥；跨页互斥由 UNDO_EXEC_LOCK 保证。 */
  const isExecuting = (): boolean => get().undoing || get().redoing;

  const scheduleToastClear = (): void => {
    clearTimeout(toastTimer);
    // 提示条显示时长来自设置（默认 7 秒），不再硬编码。
    const durationSec = useDataStore.getState().settings.toastDurationSec;
    toastTimer = setTimeout(() => {
      set({ toast: null });
    }, durationSec * 1000);
  };

  /** 提示条统一出口：把刚展示的淘汰告知并入回执 note，避免被覆盖后永久漏发。 */
  const showToast = (toast: ToastState): void => {
    const current = get().toast;
    // 显式 note > 写盘失败 > 淘汰告知；每项只消费一次。
    const persistNote = undoPersistFailed
      ? translate('撤销记录未能写入磁盘，重启后可能无法撤销')
      : undefined;
    undoPersistFailed = false;
    // 当前提示仍是淘汰告知时带出整个队列；否则视为过期，不挂到无关回执。
    const showingEviction =
      current !== null && pendingEvictionToasts.some((message) => current.message === message);
    const carried = showingEviction ? [...pendingEvictionToasts] : [];
    const note = toast.note ?? persistNote ?? (carried.length > 0 ? carried.join('；') : undefined);
    pendingEvictionToasts.length = 0;
    set({ toast: note === undefined ? toast : { ...toast, note } });
    scheduleToastClear();
  };

  /**
   * 撤销快照恢复批次：这类记录对应仍打开的标签，因此撤销是关闭而非重新打开。
   * 关闭结果生成 restore-undo 批次，允许再次撤销。
   */
  const closeRestoredBatch = async (
    batch: UndoBatch,
    windowId: number,
    onCommitted: (currentStack: UndoBatch[], retryBatch: UndoBatch | undefined) => void
  ): Promise<void> => {
    clearTimeout(toastTimer);
    set({ toast: null });

    // 目标窗口的标签快照：恢复可能落在非当前窗口，按 tabStore（当前窗口）匹配会全漏。
    // 取不到就**中止**：若降级用当前窗口的标签集继续匹配，当前窗口里网址相同、
    // 与本次恢复毫无关系的标签会被当成恢复产物关掉 —— 那是真误伤，
    // 比「这次撤销没生效」严重得多。宁可不撤销，也不关不该关的标签。
    const tabs = await queryWindowTabs(windowId).catch(() => undefined);
    if (tabs === undefined) {
      // 走 showToast 而非裸 set：提示条统一出口会把「撤销记录写盘失败」的说明
      // 并进本次回执（见 showToast 注释）。绕过它时该标记会滞留到下一次**任意**
      // 提示上，把「未能写入磁盘」挂到一次写盘成功的操作 —— 假告警。
      showToast({
        message: translate('未能读取目标窗口，暂无法撤销（请切到该窗口后重试）'),
        canUndo: false,
        batchId: undefined,
        tone: 'error'
      });
      return;
    }
    // 必须带上固定标签：快照恢复会按快照里的 pinned 状态新建**固定**标签，
    // 它们正是本次要关掉的对象（默认豁免是给 redo 用的，那里关的是用户自己固定的页）。
    const targets = selectRedoTargets(tabs, batch.entries, { includePinned: true });

    if (targets.length === 0) {
      // 两种成因必须分开处置，不能合并成一句「已不在窗口中」：
      //  - 窗口里**已经没有任何标签** → 这批确实被关掉了，出栈（不留悬空条目）；
      //  - 窗口有标签但没匹配上 → 只说明本次没定位到（网址被导航改过、快照取错窗口），
      //    标签很可能还开着。此时出栈会让撤销入口凭空消失，还附一句与事实相反的话。
      if (tabs.length === 0) {
        onCommitted(get().batches, undefined);
        await enqueueUndoPersist((disk) => disk.filter((entry) => entry.id !== batch.id));
        showToast({
          message: translate('这些标签已不在窗口中，无需撤销'),
          canUndo: false,
          batchId: undefined
        });
      } else {
        // 保留批次（不是悬空条目：重试成功才出栈），明确告知以便用户再试。
        showToast({
          message: translate('未能定位到本次恢复的标签，可稍后重试（这些标签可能已经改变了网址）'),
          canUndo: false,
          batchId: undefined,
          tone: 'error'
        });
      }
      return;
    }

    // 组名必须在关闭前捕获（整组关闭后组已消失，撤销记录会缺 groupName）。
    // 组表同样要按**目标窗口**取：tabStore 只持有当前窗口的组，跨窗口撤销时
    // 用它匹配会全漏，恢复后标签还在、原生分组却丢了。
    // 因此查询失败**不能**退回 tabStore 的组：那正好是上面警告过的错误做法 ——
    // 跨窗口时会把 A 窗口的组名套到 B 窗口的标签上，撤销恢复按错误组名重建分组
    // （比「缺组名」更糟：缺了只是丢分组，错了是进错组）。宁可空表，且必须留痕。
    const groups = await queryWindowGroups(windowId).catch((error) => {
      logDegraded('undo', `窗口 ${windowId} 原生组查询失败，撤销记录缺组名`, error);
      return [];
    });
    const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
    const closedIds = await useTabStore.getState().closeTabs(targets.map((tab) => tab.id));
    const closed = targets.filter((tab) => closedIds.includes(tab.id));
    if (closed.length === 0) {
      // 一个都没关掉：保留批次让用户重试，不吞掉这次撤销。
      showToast({
        message: translate('操作失败，请稍后重试'),
        canUndo: false,
        batchId: undefined,
        tone: 'error'
      });
      return;
    }

    onCommitted(get().batches, undefined);
    await enqueueUndoPersist((disk) => disk.filter((entry) => entry.id !== batch.id));

    const closedBatch = createUndoBatch(
      'restore-undo',
      closed.map((tab) => toUndoTabRecord(tab, groupNameById)),
      { windowId }
    );
    await appendBatch(closedBatch);
    showToast({
      message: translate('已关闭 {{count}} 个标签', { count: closed.length }),
      canUndo: true,
      batchId: closedBatch.id
    });
  };

  /**
   * 撤销执行体（undo / undoBatch 共用）。
   *
   * 关键语义：恢复成功才出栈。先出栈再恢复时，一旦部分或全部恢复失败，
   * 该批次的撤销记录已经消失，用户既没拿回标签也失去了重试入口。
   * 本实现：先恢复 → 按结果决定整批移除还是保留失败项（失败项重新入栈，可再次撤销）。
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
      showToast({
        message: translate('操作失败，请稍后重试'),
        canUndo: false,
        batchId: undefined,
        tone: 'error'
      });
      return;
    }
    // kind='restore' 记的是「快照恢复新建出来、此刻仍开着」的标签 —— 撤销它要
    // 走关闭分支，常规分支（重新打开）对它只会空转并给出假回执。
    if (batch.kind === 'restore') {
      await closeRestoredBatch(batch, windowId, onCommitted);
      return;
    }
    clearTimeout(toastTimer);
    set({ toast: null });

    const result = await restoreTabRecordsDetailed(batch.entries, windowId);
    const failedCount = result.failed.length;
    // 失败项保留为一个新批次（放回栈顶，位置最靠前，便于立刻重试）。
    const retryBatch = failedCount > 0 ? { ...batch, entries: result.failed } : undefined;
    // 回退基线：两栈在本次撤销前的状态（双栈写盘失败时整体回到这里）。
    const beforeBatches = get().batches;
    const beforeRedoBatches = get().redoBatches;
    // 出栈基于「此刻的栈」而非入口快照：恢复期间可能有新批次入栈（如同步关闭），
    // 用入口快照会把它们整批抹掉。
    onCommitted(get().batches, retryBatch);

    // 撤销成功后压入重做栈：只压「本次真正新建出来」的条目 —— 失败项仍留在
    // 撤销栈等重试；「窗口已打开同 URL 而未新建」的条目也必须排除：重做按 URL
    // 反查关闭，把它们算进来会关掉用户本来就开着、与本次撤销无关的那个标签。
    const restoredEntries = batch.entries.filter(
      (entry) => !result.failed.includes(entry) && !result.skippedAlreadyOpen.includes(entry)
    );
    const redoBatch: UndoBatch | undefined =
      restoredEntries.length > 0 ? { ...batch, entries: restoredEntries } : undefined;
    const settings = await settingsRepository.read();
    if (redoBatch) {
      set({ redoBatches: pushBatch(get().redoBatches, redoBatch, settings.undoStackLimit) });
    }

    // 出栈（undo）与入栈（redo）必须同写：见 enqueueUndoRedoPersist 的取舍说明。
    // 链内以磁盘栈为基线按 id 精确移除本批次（恢复期间可能有新批次入栈，也可能
    // 是另一窗口写入的批次），失败项放回栈顶。
    const persisted = await enqueueUndoRedoPersist(
      redoBatch ? (disk) => pushBatch(disk, redoBatch, settings.undoStackLimit) : undefined,
      (disk) => {
        const remaining = disk.filter((entry) => entry.id !== batch.id);
        return retryBatch ? [retryBatch, ...remaining] : remaining;
      }
    );
    if (!persisted) {
      // 整体回退内存态：两栈要么一起落盘、要么一起保持撤销前的样子。留在
      // 「内存说可重做、磁盘上没有」的分叉上，最坏的是重启后重做入口凭空消失，
      // 而界面刚刚还承诺过可重做。标签已恢复的事实回退不了，但撤销记录回得去
      // （恢复管线对「窗口中已有同 URL」的条目按 skipped 处理，不会重复打开）。
      set({ batches: beforeBatches, redoBatches: beforeRedoBatches });
      // 可见回执：由下方 showToast 经 undoPersistFailed 转成本次回执的 note。
      undoPersistFailed = true;
    }

    showToast({
      message:
        failedCount > 0
          ? translate('已恢复 {{count}} 个标签；{{failed}} 个恢复失败，已保留在撤销历史中可重试', {
              count: result.count,
              failed: failedCount
            })
          : translate('已恢复 {{count}} 个标签', { count: result.count }),
      canUndo: false,
      batchId: undefined,
      // 查询目标窗口失败（按不去重继续）时附一句说明：本次可能多建了副本，
      // 属信息而非错误，走 note 同槽展示，不阻断流程也不改回执口径。
      note: result.degraded ? translate('未能读取窗口现状，可能多开了已经打开着的页面') : undefined,
      // 重做出口挂在本次撤销的回执上：撤销刚发生，正是用户最可能反悔的时刻。
      action:
        get().redoBatches.length > 0
          ? { label: translate('重做'), run: () => void get().redo() }
          : undefined
    });
  };

  /** 撤销入口的公共护栏（undo / undoBatch 共用）：跨页锁 → 跨页复核 → 执行。 */
  const runGuardedUndo = async (
    batch: UndoBatch,
    onCommitted: (currentStack: UndoBatch[], retryBatch: UndoBatch | undefined) => void
  ): Promise<void> => {
    // CAS：置位与判据必须是同一次同步操作，不能分开。
    //
    // 调用方（`undo` / `undoBatch`）的 `isExecuting()` 在 `await get().load()` **之前**
    // 判定，而置位在这里（await 之后）。于是 ready=false 时同一 tick 的两次撤销会
    // 各自通过那道判空、各自 await 同一个 loadInFlight、各自 popBatch 拿到**同一个**
    // latest —— 同一批标签被恢复两次（撤销从安全网变成重复标签制造机）。
    // persistUndo=false 时跨页复核整段跳过，那道判空是唯一拦截，缺口更大。
    //
    // 放在本函数开头（await 之前同步执行）覆盖全部调用方：zustand 的 set 同步生效，
    // 置位后同 tick 内的第二个调用方立刻读到。
    if (get().undoing || get().redoing) return;
    set({ undoing: true });
    try {
      // 跨页互斥：锁名声明在同层的 crossPageLock（存储键不散落到 store）。
      // 锁内先按磁盘栈复核批次仍存在（他页可能已撤销），双重恢复由此根治。
      await withCrossPageLock(UNDO_EXEC_LOCK, async () => {
        // 跨页复核：另一窗口可能已撤销同一批次（内存栈经 watch 收敛存在延迟窗口）。
        // persistUndo 开启时磁盘是跨页权威；关闭时各页内存互不可见，退化为页内语义。
        const settings = await settingsRepository.read();
        if (settings.persistUndo) {
          const disk = await undoRepository.read();
          if (!disk.some((entry) => entry.id === batch.id)) {
            // 磁盘查不到该批次（如批次在 persistUndo 关闭期间入栈、之后用户重新开启，
            // 或已被另一页面撤销）：不得静默 return——「点了撤销没反应」会让用户
            // 以为扩展卡住。批次留在内存栈中不弹出，用户至少明确知道本次未执行。
            set({
              toast: {
                message: translate('操作失败，请稍后重试'),
                canUndo: false,
                batchId: undefined,
                tone: 'error'
              }
            });
            scheduleToastClear();
            return;
          }
        }
        await runUndo(batch, onCommitted);
      });
    } finally {
      set({ undoing: false });
    }
  };

  /** 入栈并持久化（closeWithUndo 与 recordClosedBatch 共用）。 */
  const appendBatch = async (batch: UndoBatch): Promise<void> => {
    // load 在途期间不得基于内存栈入栈：load 完成时会以旧磁盘值覆盖内存，
    // 在途入栈的批次会被整批抹掉（面板秒开秒操作可确定性复现）。
    if (!get().ready) await get().load();
    const settings = await settingsRepository.read();
    const { kept, evicted } = pushBatchWithEvicted(get().batches, batch, settings.undoStackLimit);
    set({ batches: kept });
    // 淘汰告知：栈深上限是已披露且用户可调的，缺的是「淘汰发生那一刻」
    // 的一次提示——否则用户只在打开撤销历史时才发现旧批次不见了。
    // 只在真正淘汰时提示，且由 toast（非 alert）承载 —— 这是信息而非错误。
    if (evicted.length > 0) {
      // 走 notifyEviction 合并：连续关闭会一次次淘汰，逐次提示会互相顶掉。
      get().notifyEviction(
        'undo-stack',
        translate('撤销记录已达上限，最早的 {{count}} 次关闭无法恢复（可在设置中调大上限）', {
          count: evicted.length
        })
      );
    }
    // 新的关闭批次入栈即清空重做栈：重做只对「最近一次撤销」有意义，用户一旦
    // 开始新的关闭动作，旧的重做项已不再对应当前状态（否则重做会去关无关的标签）。
    // 仅栈非空时才写盘：绝大多数关闭路径不产生额外写。
    if (get().redoBatches.length > 0) {
      set({ redoBatches: [] });
      await enqueueRedoPersist(() => [], { alwaysWrite: true });
    }
    // 入队持久化：链内以磁盘栈为基线追加本批次（磁盘可能已含另一窗口写入的
    // 批次或已发生的撤销出栈）；persistUndo 关闭时不写库（链内检查）。
    await enqueueUndoPersist((disk) => pushBatch(disk, batch, settings.undoStackLimit));
  };

  return {
    batches: [],
    redoBatches: [],
    toast: null,
    ready: false,
    undoing: false,
    redoing: false,

    load: async () => {
      loadInFlight ??= (async () => {
        // 跨页同步：其它侧边栏窗口的入栈/出栈经 watcher 回流，
        // 否则本页旧内存栈下次写盘时会整表覆盖对方改动（undoRepository 写是全量写）。
        // watcher 必须先于 read 注册：读完成到注册之间的跨页入栈若无人接收，
        // 本页下次全量写盘会把对方批次从磁盘抹掉。
        if (!undoWatcherStarted) {
          undoWatcherStarted = true;
          watcherUnsubscribers.push(
            undoRepository.watch((value) => {
              // 回显守卫：本页写入触发的回放内容相同，跳过 set。
              // 与 snapshotStore / dataStore 统一用 structuralSignature 做结构比较：
              // 撤销栈上限不确定地增长（createUndoBatch 逐批累积），裸 JSON.stringify
              // 每次 storage 变更都全量序列化两遍，属可避免的固定开销。
              if (structuralSignature(value) === structuralSignature(get().batches)) return;
              set({ batches: value });
            })
          );
        }
        // 重做栈同样需要跨页回流：另一页撤销写入的重做项在本页内存看不到时，
        // 「入栈即清重做栈」的守卫（仅看内存）就不会触发，陈旧的重做项会留到
        // 下次重做 —— 重做按 URL 反查，可能关掉与本次撤销无关的标签。
        if (!redoWatcherStarted) {
          redoWatcherStarted = true;
          watcherUnsubscribers.push(
            redoRepository.watch((value) => {
              if (structuralSignature(value) === structuralSignature(get().redoBatches)) return;
              set({ redoBatches: value });
            })
          );
        }
        // 两个栈都要留基线：只守卫 batches 时，read 在途期间外部写入的**重做栈**
        // 会被这里读到的磁盘旧值整表覆盖（重做按 URL 反查关闭，旧栈复活意味着
        // 重做可能去关与本次撤销无关的标签）。
        const before = get().batches;
        const beforeRedo = get().redoBatches;
        const settings = await settingsRepository.read();
        const batches = settings.persistUndo ? await undoRepository.read() : [];
        const redoBatches = settings.persistUndo ? await redoRepository.read() : [];
        if (!settings.persistUndo) {
          await enqueueUndoPersist(() => [], { alwaysWrite: true });
          await enqueueRedoPersist(() => [], { alwaysWrite: true });
        }
        // read 在途期间 watcher 已回放更新的值（引用变化）时以**内存**为准：
        // 磁盘读的是回放之前的状态，回写会让对方刚写入的内容消失。
        // 逐栈判定而非「任一变化就两个栈都不落」：另一栈确实没被回放过，
        // 此刻磁盘值就是它的最新已知状态，不落会让它停在加载前的旧值上。
        const batchesChanged = get().batches !== before;
        const redoChanged = get().redoBatches !== beforeRedo;
        set({
          batches: batchesChanged ? get().batches : batches,
          redoBatches: redoChanged ? get().redoBatches : redoBatches,
          ready: true
        });
      })().finally(() => {
        loadInFlight = null;
      });
      await loadInFlight;
    },

    closeWithUndo: async (tabs, tabIds) => {
      const idSet = new Set(tabIds);
      const requested = tabs.filter((tab) => idSet.has(tab.id));
      const closing = requested.filter((tab) => !tab.pinned);
      if (closing.length === 0) {
        if (requested.length > 0) {
          set({
            toast: {
              message: translate('没能关闭标签：{{count}} 个正在使用或已不存在，可稍后重试', {
                count: requested.length
              }),
              canUndo: false,
              batchId: undefined
            }
          });
          scheduleToastClear();
        }
        return;
      }

      // 组名必须在关闭前捕获：整组关闭后组已消失，TabSyncService 刷新一旦先落地，
      // groups 快照里就查不到该组 → 撤销记录缺 groupName → 恢复时无法按名重建组。
      // 组表同样要按**目标窗口**取（与下面的 undo 路径同口径）：tabStore 只持有
      // 当前窗口的组，关闭其他窗口的标签时用它会全漏，撤销回来原生分组就丢了。
      // 批量关闭可能横跨多个窗口：组表必须按窗口逐个取再合并。只取 closing[0]
      // 所在窗口时，其余窗口的 groupName 全丢 —— 撤销回来标签还在、原生分组却没了。
      const currentWindowId = useTabStore.getState().currentWindowId;
      const groupNameById = new Map<number, string | undefined>();
      for (const windowId of new Set(closing.map((tab) => tab.windowId))) {
        // 当前窗口用 tabStore 快照（无需再查）；其他窗口走 platform 查询，
        // 查询失败只影响组名（退化为无组名），不阻断关闭本身 —— 但必须留痕：
        // 组名缺失意味着撤销回来时无法按名重建组（原生分组就此丢失），
        // 用户看到的是「撤销了但分组没了」，而诊断里本该有据可查。
        const groups =
          windowId === currentWindowId
            ? useTabStore.getState().groups
            : await queryWindowGroups(windowId).catch((error) => {
                logDegraded('undo', `窗口 ${windowId} 原生组查询失败，撤销记录缺组名`, error);
                return [];
              });
        for (const group of groups) groupNameById.set(group.id, group.title);
      }

      const closedIds = await useTabStore.getState().closeTabs(closing.map((tab) => tab.id));
      const closedIdSet = new Set(closedIds);
      const closed = closing.filter((tab) => closedIdSet.has(tab.id));
      if (closed.length === 0) {
        set({
          toast: {
            message: translate('没能关闭标签：{{count}} 个正在使用或已不存在，可稍后重试', {
              count: requested.length
            }),
            canUndo: false,
            batchId: undefined
          }
        });
        scheduleToastClear();
        return;
      }

      const batch = createUndoBatch(
        'close',
        closed.map((tab) => toUndoTabRecord(tab, groupNameById)),
        { windowId: closed[0]?.windowId ?? useTabStore.getState().currentWindowId }
      );

      await appendBatch(batch);

      const skipped = requested.length - closed.length;
      showToast({
        message:
          skipped > 0
            ? translate('已关闭 {{count}} 个标签；{{skipped}} 个无法关闭', {
                count: closed.length,
                skipped
              })
            : translate('已关闭 {{count}} 个标签', { count: closed.length }),
        canUndo: true,
        batchId: batch.id
      });
    },

    undo: async () => {
      if (isExecuting()) return;
      // 与 appendBatch 同口径：load 在途期间内存栈尚未就绪，此时取栈顶会取到空栈
      // 或残缺栈，表现为「点了撤销没反应」（面板秒开后立即按 ⌘Z 可复现）。
      if (!get().ready) await get().load();
      const [latest] = popBatch(get().batches);
      if (!latest) {
        // 撤销栈为空时不能静默：命令面板的「撤销」与快捷键常驻可用，用户点了
        // 必须知道原因，否则「没有可撤销的操作」会被读成「扩展坏了 / 快捷键失灵」。
        set({
          toast: {
            message: translate('没有可撤销的操作'),
            canUndo: false,
            batchId: undefined
          }
        });
        scheduleToastClear();
        return;
      }
      await runGuardedUndo(latest, (current, retryBatch) => {
        // 恢复已发生：此时才出栈（按 id 精确移除，不用 popBatch——恢复期间
        // 可能有新批次入栈，栈尾未必还是本批）。失败项放回栈顶保留重试入口。
        const remaining = current.filter((entry) => entry.id !== latest.id);
        set({ batches: retryBatch ? [retryBatch, ...remaining] : remaining });
      });
    },

    undoBatch: async (batchId) => {
      if (isExecuting()) return;
      // 与 `undo` 同口径：撤销历史面板是持久化列表，面板在 load 完成前就能渲染出
      // 条目（数据来自磁盘而非本页内存栈）。此时按内存栈查找必然 miss，会给出
      // 与事实相反的「该操作已不存在」——条目其实还在，只是本页还没读进来。
      if (!get().ready) await get().load();
      const batch = get().batches.find((entry) => entry.id === batchId);
      if (!batch) {
        // 按 id 找不到批次（已被另一页面/上一次撤销消费）。撤销历史面板里的
        // 条目是持久化的，用户点得到就必须给答复，静默会被读成「点了没反应」。
        set({
          toast: {
            message: translate('该操作已不存在，可能已被撤销'),
            canUndo: false,
            batchId: undefined,
            tone: 'error'
          }
        });
        scheduleToastClear();
        return;
      }
      await runGuardedUndo(batch, (current, retryBatch) => {
        const remaining = current.filter((entry) => entry.id !== batchId);
        set({
          batches: retryBatch ? [retryBatch, ...remaining] : remaining
        });
      });
    },

    /**
     * 重做：把刚被撤销（恢复）回来的标签再次关闭。
     *
     * 为什么按 URL 匹配当前窗口标签：撤销记录只有 URL / 位置 / 状态五元组，
     * 没有浏览器 tabId（关闭后即失效，恢复出来的是新 id），因此重做只能按
     * URL 反查——固定标签豁免，与关闭路径同口径。
     */
    redo: async () => {
      if (isExecuting()) return;
      // 同上：重做栈同样要等 load 完成，否则取到的是未加载的空栈。
      if (!get().ready) await get().load();
      const [latest] = popBatch(get().redoBatches);
      if (!latest) {
        // 同 undo：重做栈为空时必须说出来，否则表现为「点了重做没反应」。
        set({
          toast: {
            message: translate('没有可重做的操作'),
            canUndo: false,
            batchId: undefined
          }
        });
        scheduleToastClear();
        return;
      }
      set({ redoing: true });
      try {
        await withCrossPageLock(UNDO_EXEC_LOCK, async () => {
          // 目标窗口必须与「撤销时恢复到哪个窗口」同口径：撤销回的是原窗口（可能是
          // 另一个窗口），按 tabStore 的当前窗口反查会关掉本窗口里同 URL 的无关标签。
          const redoWindowId = await resolveRestoreWindowId(latest.windowId);
          // 与 closeRestoredBatch 同口径：目标窗口读不到就中止，绝不退回当前窗口匹配
          // （会把当前窗口里同 URL 的无关标签当成恢复产物关掉）。
          // 注意这里**不能**用 `useTabStore.getState().tabs` 兜底：那是当前窗口的标签集，
          // 重做窗口是另一窗口时等于拿别人的标签按 URL 反查并关闭 —— 真误伤。
          const tabs =
            redoWindowId === undefined
              ? undefined
              : await queryWindowTabs(redoWindowId).catch(() => undefined);
          if (tabs === undefined) {
            // 不清栈：这次只是读不到窗口，重做项本身仍然有效。
            set({
              toast: {
                message: translate('未能读取目标窗口，暂无法重做（请切到该窗口后重试）'),
                canUndo: false,
                batchId: undefined,
                tone: 'error'
              }
            });
            scheduleToastClear();
            return;
          }
          const targets = selectRedoTargets(tabs, latest.entries);
          if (targets.length === 0) {
            // 目标标签已不在（用户手动关掉了）：重做没有对象，清栈并明确告知。
            // 不能静默 return —— 否则用户会以为「点了重做没反应」。
            set({ redoBatches: [] });
            await enqueueRedoPersist(() => [], { alwaysWrite: true });
            set({
              toast: {
                message: translate('这些标签已不在窗口中，无需重做'),
                canUndo: false,
                batchId: undefined
              }
            });
            scheduleToastClear();
            return;
          }

          // 组名必须在关闭前捕获（整组关闭后组已消失，撤销记录会缺 groupName）。
          // 与 closeRestoredBatch 同口径：按重做目标窗口取组表，不能用当前窗口的。
          // 查询失败同样**不能**退回 tabStore 的组（那是当前窗口的表，
          // 套到别的窗口的标签上就是张冠李戴）；宁可缺组名，且必须留痕。
          const groups = await queryWindowGroups(redoWindowId).catch((error) => {
            logDegraded('undo', `窗口 ${redoWindowId} 原生组查询失败，撤销记录缺组名`, error);
            return [];
          });
          const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
          const closedIds = await useTabStore.getState().closeTabs(targets.map((tab) => tab.id));
          const closed = targets.filter((tab) => closedIds.includes(tab.id));
          if (closed.length === 0) {
            set({
              toast: {
                message: translate('操作失败，请稍后重试'),
                canUndo: false,
                batchId: undefined,
                tone: 'error'
              }
            });
            scheduleToastClear();
            return;
          }

          // 关闭结果重新入撤销栈：重做不是单向门，用户仍可再次撤销回到「已恢复」状态。
          // appendBatch 内部会清空重做栈，本次已消费的重做项无需额外清理。
          const batch = createUndoBatch(
            'redo-close',
            closed.map((tab) => toUndoTabRecord(tab, groupNameById)),
            { windowId: closed[0]?.windowId ?? useTabStore.getState().currentWindowId }
          );
          await appendBatch(batch);
          showToast({
            message: translate('已重做：再次关闭 {{count}} 个标签（可再次撤销）', {
              count: closed.length
            }),
            canUndo: true,
            batchId: batch.id
          });
        });
      } finally {
        set({ redoing: false });
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

    recordReuseClosed: async (windowId, records) => {
      if (records.length === 0) return;
      const batch = createUndoBatch('reuse', [...records], { windowId });
      await appendBatch(batch);
    },

    clearToast: () => {
      clearTimeout(toastTimer);
      set({ toast: null });
    },

    notify: (message, action) => {
      showToast({ message, canUndo: false, batchId: undefined, action, tone: 'info' });
    },

    notifyError: (message) => {
      showToast({ message, canUndo: false, batchId: undefined, tone: 'error' });
    },

    notifyFailure: (scope, message, error) => {
      logDegraded(scope, message, error);
      showToast({ message, canUndo: false, batchId: undefined, tone: 'error' });
    },

    notifyEviction: (key, message) => {
      // 合并：同一类淘汰本会话内只提示一次。容量语义没变，重复提示只会刷屏。
      if (notifiedEvictions.has(key)) return;
      notifiedEvictions.add(key);
      // 先独立展示，同时登记为「待回执接走」：淘汰发生在回执之前（appendBatch 内
      // 淘汰 → 调用方随后设「已关闭 N 个」），回执经 showToast 会把它并入 note；
      // 若本次操作没有回执（如后台归档登记），它就以独立提示条的形式留在界面上。
      //
      // 入队而非覆盖：同一操作内两类淘汰（快照上限 / 撤销栈上限）先后发生时，
      // 单槽会让后一条顶掉前一条，而前一条的 key 已标记为已提示 —— 那条告知
      // 就此永久漏发。
      pendingEvictionToasts.push(message);
      // 刻意不经 showToast：否则本次展示会把自己登记的那条又消费掉。
      set({ toast: { message, canUndo: false, batchId: undefined, tone: 'info' } });
      scheduleToastClear();
    },

    clearBatches: async () => {
      clearTimeout(toastTimer);
      set({ batches: [], redoBatches: [], toast: null });
      // 清空全部数据等同开启一个新会话：淘汰提示的「本会话一次」记账必须一并清空。
      // 否则在 SW 这类长驻上下文里它跨过清空一直生效，此后淘汰再也不会提示。
      notifiedEvictions.clear();
      // 持久层通常已被 storage.local.clear 清空，此处入队写空数组兜底（并消除文件缺失歧义）。
      await enqueueUndoPersist(() => [], { alwaysWrite: true });
      await enqueueRedoPersist(() => [], { alwaysWrite: true });
    }
  };
});

// HMR 重载时退订 watcher（见 watcherUnsubscribers 的注释）：模块级守卫会随重载
// 重置，而旧监听器仍挂着并把旧值写回新实例 —— 真实泄漏 + 旧栈复活。
import.meta.hot?.dispose(() => {
  for (const unsubscribe of watcherUnsubscribers) unsubscribe();
  watcherUnsubscribers.length = 0;
  undoWatcherStarted = false;
  redoWatcherStarted = false;
});
