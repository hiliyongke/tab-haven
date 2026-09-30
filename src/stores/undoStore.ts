import { create } from 'zustand';
import {
  createUndoBatch,
  popBatch,
  pushBatch,
  pushBatchWithEvicted,
  selectRedoTargets,
  toUndoTabRecord
} from '@/core/undo/UndoStack';
import type { UndoBatch } from '@/core/schema/models';
import { structuralSignature } from '@/core/util/signature';
import i18n from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import {
  redoRepository,
  settingsRepository,
  undoRepository
} from '@/platform/storage/repositories';
import { UNDO_PERSIST_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { restoreTabRecordsDetailed } from '@/platform/undo/RestoreEngine';
import { queryWindowTabs, resolveRestoreWindowId } from '@/platform/tabs';
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
  /**
   * 附属信息（与回执同槽展示）：淘汰告知用。
   *
   * 淘汰发生在操作回执之前（appendBatch 内淘汰 → 调用方随后设「已关闭 N 个」），
   * 若淘汰单独占一条提示，回执会立刻把它顶掉；而 key 已被记为「已提示」，
   * 本会话内再也不会提示 —— 淘汰告知因此永久漏发。故回执把它接过来同槽展示。
   */
  note?: string;
  /**
   * 语义强度：error 走 role="alert"（打断读屏、立刻播报），info 走
   * role="status"（排队播报）。此前所有提示一律 status/polite，失败提示
   * 与「已保存」同权重——对依赖读屏的用户，操作失败是最不该被延后的信息。
   */
  tone?: 'info' | 'error';
}

interface UndoState {
  batches: UndoBatch[];
  /**
   * 重做栈：撤销成功后压入「本次被恢复回来的条目」，结构与撤销栈相同。
   * 生命周期与撤销栈不同——任何新的关闭批次入栈即清空（重做只对最近一次撤销有意义）。
   */
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
  /** 撤销最近一步。 */
  undo: () => Promise<void>;
  /** 撤销指定批次（撤销历史面板用）。 */
  undoBatch: (batchId: string) => Promise<void>;
  /**
   * 重做最近一次撤销：把刚被恢复回来的标签再次关闭。
   * 关闭结果会**重新入撤销栈**（可再次撤销），因此重做不会把用户锁死在某一状态。
   */
  redo: () => Promise<void>;
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
  /** 失败提示：读屏即刻播报（role="alert"），不与其他提示排队。 */
  notifyError: (message: string) => void;
  /**
   * 淘汰提示（R18 / S-3）：同一 key 在本会话内只提示一次。
   *
   * 三类淘汰（稍后读超限、快照超限、撤销栈超限）都是「每次触发容量的操作都会
   * 再淘汰一条」——批量关 50 个标签、连续保存快照都会连着触发几十次。若每次都弹
   * toast，提示条会互相顶掉且刷屏，用户反而看不到任何一条。故按 key 合并：
   * 同类淘汰在本会话内只提示一次（内容与数量以首次为准）。
   */
  notifyEviction: (key: string, message: string) => void;
  /** 清空撤销栈（内存 + 持久化）。清除所有数据时调用——被清除的数据不参与撤销。 */
  clearBatches: () => Promise<void>;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * 已提示过的淘汰 key（R18 / S-3）。
 *
 * 模块级而非 store 内：它是「本会话内提示过没有」的记录，不属于可序列化的 UI 状态，
 * 放进 store 会被快照测试与 setState 复位连带清掉。副作用仅是重复淘汰不再提示
 * （用户已被告知一次，容量语义没有变化）。
 */
const notifiedEvictions = new Set<string>();
/**
 * 已展示、等待被回执接走的淘汰告知（消息文本）。
 *
 * 淘汰告知先于回执展示，回执随即覆盖它 —— 若不把它接进回执的 note，用户一条
 * 都看不到（且 key 已标记已提示，不会再提示第二次）。这里记文本而非布尔值：
 * 只有当「当前提示条仍是那条淘汰告知」时才并入，避免把过期很久的告知挂到
 * 之后某次不相关的回执上。
 */
let pendingEvictionToast: string | undefined;
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
 * 撤销执行跨页互斥锁名。
 *
 * undoInFlight 只拦本页面：两个侧边栏窗口（各自独立上下文）可同时撤销同一批次，
 * 同一批标签被恢复两次。执行体经 withCrossPageLock(UNDO_EXEC_LOCK) 串行化，
 * 且锁内先按磁盘栈复核批次仍存在（他页可能已撤销），双重恢复由此根治。
 */
const UNDO_EXEC_LOCK = 'tabs.undo-exec';

/**
 * 在途 load 的共享 promise：并发/重入（StrictMode 双挂载、ready 前入栈等待）
 * 共享同一次读取，避免两条 load 链各自读盘再以旧值覆盖新值。
 * 完成后自动清空——再次 load 仍重新读盘（跨重启回读语义不变）。
 */
let loadInFlight: Promise<void> | null = null;
/** 仓库 watcher 注册守卫（跨页撤销栈同步，只注册一次）。 */
let undoWatcherStarted = false;
/** 同上，重做栈一份：两个仓库各自整表写，各需一个 watcher。 */
let redoWatcherStarted = false;

/**
 * undoRepository 写盘串行链（追加顺序）。
 *
 * 撤销恢复耗时数百 ms，期间新批次仍可入栈（closeWithUndo 刻意不受
 * undoInFlight 拦截）。旧实现中 appendBatch 与撤销出栈各自基于自己的快照
 * 写盘，两条异步链的 `chrome.storage.set` 完成先后无保证 —— 磁盘终态可能
 * 是被「旧栈+新批」覆盖（已撤销批次重启后复活，可被再次撤销、重复恢复标签）。
 * 统一收口到本链，且写盘内容一律在链内以「磁盘基线 + 本页意图」计算（apply），
 * 既消除读-写窗口，也避免跨页整表覆盖。
 */
let undoPersistChain: Promise<void> = Promise.resolve();
/**
 * 入队一次撤销库写盘，返回该步骤完成的 promise（调用方按需等待）。
 *
 * `apply` 接收锁内重读到的磁盘栈，返回本次要落盘的栈：撤销栈是整表写，
 * 两个侧边栏窗口并发入栈/出栈时「写本页内存栈」会互相覆盖（已撤销批次复活 /
 * 新批次从磁盘消失），以磁盘为基线叠加本页意图才能两边都不丢。
 *
 * 常规写入（入栈/撤销出栈）遵循 persistUndo 开关（关闭时不写库）；
 * 清库类写入（load 清历史库 / clearBatches 兜底）必须无条件执行：
 * 它们防的是「上一轮开启时留下的批次复活」，与开关无关。
 */
function enqueueUndoPersist(
  apply: (disk: UndoBatch[]) => UndoBatch[],
  opts?: { alwaysWrite?: boolean }
): Promise<void> {
  const step = undoPersistChain.then(async () => {
    if (!opts?.alwaysWrite) {
      const settings = await settingsRepository.read();
      if (!settings.persistUndo) return;
    }
    await withCrossPageLock(UNDO_PERSIST_LOCK, async () => {
      const disk = await undoRepository.read();
      const ok = await undoRepository.write(apply(disk));
      if (!ok) logFailure('undoStore', '撤销历史写入失败，本次撤销状态可能未持久化');
    });
  });
  undoPersistChain = step.catch((error) => logFailure('undoStore', '撤销历史写入失败', error));
  return step;
}

/**
 * redoRepository 写盘串行链（与撤销栈同构，独立一条链：两个栈的写入互不阻塞，
 * 各自整表写 + 串行即可保证终态正确）。
 *
 * 跨页锁复用 UNDO_PERSIST_LOCK：重做栈的写入与撤销栈同源（都由撤销/重做动作
 * 驱动），共用一把锁即可串行化，不新增锁名以免锁清单漂移。
 */
let redoPersistChain: Promise<void> = Promise.resolve();

function enqueueRedoPersist(
  apply: (disk: UndoBatch[]) => UndoBatch[],
  opts?: { alwaysWrite?: boolean }
): Promise<void> {
  const step = redoPersistChain.then(async () => {
    if (!opts?.alwaysWrite) {
      const settings = await settingsRepository.read();
      // 与撤销栈同开关：关闭「撤销记录跨重启持久化」时，重做也仅会话内有效。
      if (!settings.persistUndo) return;
    }
    await withCrossPageLock(UNDO_PERSIST_LOCK, async () => {
      const disk = await redoRepository.read();
      const ok = await redoRepository.write(apply(disk));
      if (!ok) logFailure('undoStore', '重做栈写入失败，本次重做状态可能未持久化');
    });
  });
  redoPersistChain = step.catch((error) => logFailure('undoStore', '重做栈写入失败', error));
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
   * 提示条统一出口：把「刚展示的淘汰告知」并入本次提示的 note。
   *
   * 回执（「已关闭 N 个」等）一定晚于淘汰告知设置，若各自直接 set，回执会把
   * 淘汰告知顶掉 —— 而淘汰 key 已记为已提示，本会话内不会再提示，告知就此永久
   * 漏发。经本出口的提示都会把尚未被接走的淘汰告知带出来同槽展示。
   */
  const showToast = (toast: ToastState): void => {
    const current = get().toast;
    const note =
      toast.note ??
      (pendingEvictionToast !== undefined && current?.message === pendingEvictionToast
        ? pendingEvictionToast
        : undefined);
    // 无论是否并入都清空：过期的告知不得挂到之后不相关的提示上。
    pendingEvictionToast = undefined;
    set({ toast: note === undefined ? toast : { ...toast, note } });
    scheduleToastClear();
  };

  /**
   * 撤销「快照恢复」批次（kind='restore'）的执行体。
   *
   * 这类批次记的是**仍开着**的标签（快照恢复是新建，不是关闭），所以撤销它
   * 只能是「把这批标签关掉」，绝不能走常规分支的 restoreTabRecordsDetailed：
   * 那些标签还在窗口里，重开路径会因「已打开去重」全部判为成功（count=N、
   * 无失败），结果批次被出栈、提示「已恢复 N 个」而界面毫无变化 —— 既空转
   * 又给了假回执。
   *
   * 关闭后照例生成一条普通关闭批次入栈（kind='restore-undo'）：用户仍可再撤销
   * 它把标签开回来，与 redo 的「关闭后重新入栈」同构。
   */
  const closeRestoredBatch = async (
    batch: UndoBatch,
    windowId: number,
    onCommitted: (currentStack: UndoBatch[], retryBatch: UndoBatch | undefined) => void
  ): Promise<void> => {
    clearTimeout(toastTimer);
    set({ toast: null });

    // 目标窗口的标签快照：恢复可能落在非当前窗口，按 tabStore（当前窗口）匹配会全漏。
    const tabs = await queryWindowTabs(windowId).catch(() => useTabStore.getState().tabs);
    const targets = selectRedoTargets(tabs, batch.entries);

    if (targets.length === 0) {
      // 标签已被用户手动关掉：没有可撤销的对象。批次出栈（不留悬空条目）并明确告知，
      // 不能静默 return ——「点了撤销没反应」会被当成扩展卡住。
      onCommitted(get().batches, undefined);
      await enqueueUndoPersist((disk) => disk.filter((entry) => entry.id !== batch.id));
      set({
        toast: {
          message: i18n.t('undo.redoNone'),
          canUndo: false,
          batchId: undefined
        }
      });
      scheduleToastClear();
      return;
    }

    // 组名必须在关闭前捕获（整组关闭后组已消失，撤销记录会缺 groupName）。
    const groupNameById = new Map(
      useTabStore.getState().groups.map((group) => [group.id, group.title])
    );
    const closedIds = await useTabStore.getState().closeTabs(targets.map((tab) => tab.id));
    const closed = targets.filter((tab) => closedIds.includes(tab.id));
    if (closed.length === 0) {
      // 一个都没关掉：保留批次让用户重试，不吞掉这次撤销。
      set({
        toast: {
          message: i18n.t('errors.operationFailed'),
          canUndo: false,
          batchId: undefined,
          tone: 'error'
        }
      });
      scheduleToastClear();
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
      message: i18n.t('undo.closed', { count: closed.length }),
      canUndo: true,
      batchId: closedBatch.id
    });
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
          batchId: undefined,
          tone: 'error'
        }
      });
      scheduleToastClear();
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
    // 出栈基于「此刻的栈」而非入口快照：恢复期间可能有新批次入栈（如同步关闭），
    // 用入口快照会把它们整批抹掉。
    onCommitted(get().batches, retryBatch);

    // 撤销成功后压入重做栈：只压「本次真正恢复成功」的条目 —— 失败项仍留在
    // 撤销栈等重试，把它们也压进重做栈会让「重做」去关一批从未被恢复的标签。
    const restoredEntries = batch.entries.filter((entry) => !result.failed.includes(entry));
    if (restoredEntries.length > 0) {
      const redoBatch: UndoBatch = { ...batch, entries: restoredEntries };
      const settings = await settingsRepository.read();
      set({ redoBatches: pushBatch(get().redoBatches, redoBatch, settings.undoStackLimit) });
      await enqueueRedoPersist((disk) => pushBatch(disk, redoBatch, settings.undoStackLimit));
    }

    // 出栈后入队持久化：链内以磁盘栈为基线按 id 精确移除本批次（恢复期间
    // 可能有新批次入栈，也可能是另一窗口写入的批次），失败项放回栈顶。
    await enqueueUndoPersist((disk) => {
      const remaining = disk.filter((entry) => entry.id !== batch.id);
      return retryBatch ? [retryBatch, ...remaining] : remaining;
    });

    set({
      toast: {
        message:
          failedCount > 0
            ? i18n.t('undo.restoredPartial', { count: result.count, failed: failedCount })
            : i18n.t('undo.restored', { count: result.count }),
        canUndo: false,
        batchId: undefined,
        // 重做出口挂在本次撤销的回执上：撤销刚发生，正是用户最可能反悔的时刻。
        action:
          get().redoBatches.length > 0
            ? { label: i18n.t('undo.redo'), run: () => void get().redo() }
            : undefined
      }
    });
    scheduleToastClear();
  };

  /** 入栈并持久化（closeWithUndo 与 recordClosedBatch 共用）。 */
  const appendBatch = async (batch: UndoBatch): Promise<void> => {
    // load 在途期间不得基于内存栈入栈：load 完成时会以旧磁盘值覆盖内存，
    // 在途入栈的批次会被整批抹掉（面板秒开秒操作可确定性复现）。
    if (!get().ready) await get().load();
    const settings = await settingsRepository.read();
    const { kept, evicted } = pushBatchWithEvicted(get().batches, batch, settings.undoStackLimit);
    set({ batches: kept });
    // 淘汰告知（R18 / S-3）：栈深上限是已披露且用户可调的，缺的是「淘汰发生那一刻」
    // 的一次提示。此前用户只在打开撤销历史时才发现旧批次不见了。
    // 只在真正淘汰时提示，且由 toast（非 alert）承载 —— 这是信息而非错误。
    if (evicted.length > 0) {
      // 走 notifyEviction 合并：连续关闭会一次次淘汰，逐次提示会互相顶掉。
      get().notifyEviction('undo-stack', i18n.t('undo.stackEvicted', { count: evicted.length }));
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
          undoRepository.watch((value) => {
            // 回显守卫：本页写入触发的回放内容相同，跳过 set。
            // 与 snapshotStore / dataStore 统一用 structuralSignature 做结构比较：
            // 撤销栈上限不确定地增长（createUndoBatch 逐批累积），裸 JSON.stringify
            // 每次 storage 变更都全量序列化两遍，属可避免的固定开销。
            if (structuralSignature(value) === structuralSignature(get().batches)) return;
            set({ batches: value });
          });
        }
        // 重做栈同样需要跨页回流：另一页撤销写入的重做项在本页内存看不到时，
        // 「入栈即清重做栈」的守卫（仅看内存）就不会触发，陈旧的重做项会留到
        // 下次重做 —— 重做按 URL 反查，可能关掉与本次撤销无关的标签。
        if (!redoWatcherStarted) {
          redoWatcherStarted = true;
          redoRepository.watch((value) => {
            if (structuralSignature(value) === structuralSignature(get().redoBatches)) return;
            set({ redoBatches: value });
          });
        }
        const before = get().batches;
        const settings = await settingsRepository.read();
        const batches = settings.persistUndo ? await undoRepository.read() : [];
        const redoBatches = settings.persistUndo ? await redoRepository.read() : [];
        if (!settings.persistUndo) {
          await enqueueUndoPersist(() => [], { alwaysWrite: true });
          await enqueueRedoPersist(() => [], { alwaysWrite: true });
        }
        // read 在途期间 watcher 已回放更新的值（引用变化）时以其为准，只补 ready。
        if (get().batches !== before) {
          set({ ready: true, redoBatches });
          return;
        }
        set({ batches, redoBatches, ready: true });
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
              message: i18n.t('undo.closedSkipped', { count: requested.length }),
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
      const groups = useTabStore.getState().groups;
      const groupNameById = new Map(groups.map((group) => [group.id, group.title]));

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
            ? i18n.t('undo.closedPartial', { count: closed.length, skipped })
            : i18n.t('undo.closed', { count: closed.length }),
        canUndo: true,
        batchId: batch.id
      });
    },

    undo: async () => {
      if (undoInFlight) return;
      const [latest] = popBatch(get().batches);
      if (!latest) return;
      undoInFlight = true;
      set({ undoing: true });
      try {
        await withCrossPageLock(UNDO_EXEC_LOCK, async () => {
          // 跨页复核：另一窗口可能已撤销同一批次（内存栈经 watch 收敛存在延迟窗口）。
          // persistUndo 开启时磁盘是跨页权威；关闭时各页内存互不可见，退化为页内语义。
          const settings = await settingsRepository.read();
          if (settings.persistUndo) {
            const disk = await undoRepository.read();
            if (!disk.some((entry) => entry.id === latest.id)) {
              // 磁盘查不到该批次（如批次在 persistUndo 关闭期间入栈、之后用户重新开启，
              // 或已被另一页面撤销）：不得静默 return——「点了撤销没反应」会让用户
              // 以为扩展卡住。批次留在内存栈中不弹出，用户至少明确知道本次未执行。
              set({
                toast: {
                  message: i18n.t('errors.operationFailed'),
                  canUndo: false,
                  batchId: undefined,
                  tone: 'error'
                }
              });
              scheduleToastClear();
              return;
            }
          }
          await runUndo(latest, (current, retryBatch) => {
            // 恢复已发生：此时才出栈（按 id 精确移除，不用 popBatch——恢复期间
            // 可能有新批次入栈，栈尾未必还是本批）。失败项放回栈顶保留重试入口。
            const remaining = current.filter((entry) => entry.id !== latest.id);
            set({ batches: retryBatch ? [retryBatch, ...remaining] : remaining });
          });
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
        await withCrossPageLock(UNDO_EXEC_LOCK, async () => {
          const settings = await settingsRepository.read();
          if (settings.persistUndo) {
            const disk = await undoRepository.read();
            if (!disk.some((entry) => entry.id === batchId)) {
              // 同 undo：磁盘缺失时给出明确反馈而非静默返回。
              set({
                toast: {
                  message: i18n.t('errors.operationFailed'),
                  canUndo: false,
                  batchId: undefined,
                  tone: 'error'
                }
              });
              scheduleToastClear();
              return;
            }
          }
          await runUndo(batch, (current, retryBatch) => {
            const remaining = current.filter((entry) => entry.id !== batchId);
            set({
              batches: retryBatch ? [retryBatch, ...remaining] : remaining
            });
          });
        });
      } finally {
        undoInFlight = false;
        set({ undoing: false });
      }
    },

    /**
     * 重做：把刚被撤销（恢复）回来的标签再次关闭。
     *
     * 为什么按 URL 匹配当前窗口标签：撤销记录只有 URL / 位置 / 状态五元组，
     * 没有浏览器 tabId（关闭后即失效，恢复出来的是新 id），因此重做只能按
     * URL 反查——固定标签豁免，与关闭路径同口径。
     */
    redo: async () => {
      if (undoInFlight) return;
      const [latest] = popBatch(get().redoBatches);
      if (!latest) return;
      undoInFlight = true;
      set({ redoing: true });
      try {
        await withCrossPageLock(UNDO_EXEC_LOCK, async () => {
          // 目标窗口必须与「撤销时恢复到哪个窗口」同口径：撤销回的是原窗口（可能是
          // 另一个窗口），按 tabStore 的当前窗口反查会关掉本窗口里同 URL 的无关标签。
          // 与 closeRestoredBatch 的取窗口径保持一致（失败时退回当前窗口快照）。
          const redoWindowId = await resolveRestoreWindowId(latest.windowId);
          const tabs =
            redoWindowId === undefined
              ? useTabStore.getState().tabs
              : await queryWindowTabs(redoWindowId).catch(() => useTabStore.getState().tabs);
          const targets = selectRedoTargets(tabs, latest.entries);
          if (targets.length === 0) {
            // 目标标签已不在（用户手动关掉了）：重做没有对象，清栈并明确告知。
            // 不能静默 return —— 否则用户会以为「点了重做没反应」。
            set({ redoBatches: [] });
            await enqueueRedoPersist(() => [], { alwaysWrite: true });
            set({
              toast: {
                message: i18n.t('undo.redoNone'),
                canUndo: false,
                batchId: undefined
              }
            });
            scheduleToastClear();
            return;
          }

          // 组名必须在关闭前捕获（整组关闭后组已消失，撤销记录会缺 groupName）。
          const groups = useTabStore.getState().groups;
          const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
          const closedIds = await useTabStore.getState().closeTabs(targets.map((tab) => tab.id));
          const closed = targets.filter((tab) => closedIds.includes(tab.id));
          if (closed.length === 0) {
            set({
              toast: {
                message: i18n.t('errors.operationFailed'),
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
            message: i18n.t('undo.redone', { count: closed.length }),
            canUndo: true,
            batchId: batch.id
          });
        });
      } finally {
        undoInFlight = false;
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

    notifyEviction: (key, message) => {
      // 合并：同一类淘汰本会话内只提示一次。容量语义没变，重复提示只会刷屏。
      if (notifiedEvictions.has(key)) return;
      notifiedEvictions.add(key);
      // 先独立展示，同时登记为「待回执接走」：淘汰发生在回执之前（appendBatch 内
      // 淘汰 → 调用方随后设「已关闭 N 个」），回执经 showToast 会把它并入 note；
      // 若本次操作没有回执（如后台归档登记），它就以独立提示条的形式留在界面上。
      //
      // 已知取舍：极少数场景（同一操作内两类淘汰先后发生）下，后一条会覆盖尚未
      // 被接走的前一条。三类淘汰分别发生在「暂存稍后读 / 保存快照 / 关闭标签」，
      // 路径不重叠，且覆盖只影响「少提示一条」，故不为此拼接文案。
      pendingEvictionToast = message;
      // 刻意不经 showToast：否则本次展示会把自己登记的那条又消费掉。
      set({ toast: { message, canUndo: false, batchId: undefined, tone: 'info' } });
      scheduleToastClear();
    },

    clearBatches: async () => {
      clearTimeout(toastTimer);
      set({ batches: [], redoBatches: [], toast: null });
      // 持久层通常已被 storage.local.clear 清空，此处入队写空数组兜底（并消除文件缺失歧义）。
      await enqueueUndoPersist(() => [], { alwaysWrite: true });
      await enqueueRedoPersist(() => [], { alwaysWrite: true });
    }
  };
});
