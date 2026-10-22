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
  parseOneTab,
  persistSnapshot,
  replaceSpaceSnapshot,
  restoreSnapshot,
  setSnapshotEvictionListener,
  SNAPSHOTS_RMW_LOCK
} from '@/platform/snapshot/snapshots';
import { parseWorkona } from '@/core/insights/workonaImport';
import { newId } from '@/core/util/id';
import { buildPartialSnapshot } from '@/core/snapshot/snapshotDiff';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';
import { withCrossPageLock } from '@/platform/storage/crossPageLock';

/**
 * 把「本次快照恢复新建出来的标签」记为一批可撤销项。
 *
 * 采用**前后差分**而不是「恢复后按条件筛选」：后者会把窗口里原本就在的标签一并
 * 误判成「恢复出来的」，撤销时就会把它们全部关掉 —— 那比「恢复不可撤销」更糟。
 * 差分取「恢复后多出来的 tabId」，是唯一精确且不必改动 platform 层契约的做法
 * （restoreSnapshot 目前只返回数量，改返回值会影响其公开契约与既有测试）。
 */
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
    // 记录失败不得影响恢复结果本身（恢复已成功，用户只是少了一个反悔入口）——
    // 但**不留痕**是不行的：同文件 200 行外的归档路径对完全同类的失败做了
    // logFailure，本处若静默，用户点「撤销」看到「没有可撤销的操作」时，
    // 诊断导出里查不到任何原因。
    logFailure('snapshotStore', '快照恢复的撤销登记失败，本次恢复无法一键撤销', error);
  }
}

/**
 * 捕获恢复前的窗口标签 id 集合（差分基线）。
 *
 * 抽出来的理由：restore / restoreSelected 此前把这段（含「拿不到就不记账」的
 * 取舍注释）逐字复制两份。该逻辑失效的后果是「撤销会关掉用户原有标签」——
 * 高危语义有两份拷贝，意味着将来只修其中一份时，另一份保留危险版本。
 */
async function captureWindowTabIds(
  windowId: number | undefined
): Promise<ReadonlySet<number> | undefined> {
  // 拿不到恢复前现场就**不记账**：那等价于「窗口里所有标签都是新建的」，
  // 之后的撤销会把用户原有标签一并关掉 —— 比「这次恢复不可撤销」糟得多。
  if (windowId === undefined) return undefined;
  return queryWindowTabs(windowId)
    .then((tabs) => new Set(tabs.map((tab) => tab.id)))
    .catch((error: unknown) => {
      logDegraded('snapshotStore', `窗口 ${windowId} 恢复前现场读取失败，本次不登记撤销`, error);
      return undefined;
    });
}

/**
 * 注册淘汰提示：快照超限时最旧的快照会被移除，必须给出可见提示，
 * 否则用户以为一直留着，实际最早的那些已经没了。
 *
 * 重要性高于撤销栈那类：撤销栈深度是**已披露且用户可调**的设置，而这里的两条
 * 上限（maxAutoSnapshots / snapshotLimit）若不告知，用户只在打开快照列表时
 * 才发现旧快照不见了。
 */
setSnapshotEvictionListener((count) => {
  // 走 notifyEviction 合并：逐份导入 Workona（每份各走一次 persistSnapshot）会
  // 连续淘汰，逐次提示会互相顶掉且刷屏。同类淘汰本会话内只提示一次。
  useUndoStore.getState().notifyEviction(
    'snapshots',
    translate('快照已达上限，最早的 {{count}} 份已被移除（可在设置中调整快照保留数量）', {
      count
    })
  );
});

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
  /** 归档当前窗口：保存并关闭全部标签，返回保存标签数。 */
  archiveCurrentWindow: (name?: string) => Promise<number>;
  /** 从 OneTab 导出文本导入为快照，返回导入标签数。 */
  importOneTab: (text: string, name?: string) => Promise<number>;
  /**
   * 从 Workona 导出 JSON 批量导入为快照族。
   * 返回 { 导入快照数, 导入标签数, 识别但跳过的 workspace 数, 截断量, 失败原因 }。
   *
   * reason 与备份导入同口径：失败必须可解释（体积超限 / JSON 损坏 / 结构不匹配），
   * 不能让三种完全不同的失败都表现为「导入 0 条」。
   */
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
  /**
   * 恢复指定快照，返回新建标签数与降级标志；可指定目标窗口（缺省取聚焦窗口）。
   *
   * **快照不存在时抛错**，不返回 `{ count: 0 }`：返回成功形状会让调用方提示
   * 「已恢复 0 个标签」，把「没执行」说成「执行了但结果为空」。所有调用点都在
   * try/catch 或 `.catch` 里，抛出即走既有的失败出口（提示 + 诊断留痕）。
   */
  restore: (id: string, windowId?: number) => Promise<RestoreSnapshotResult>;
  /** 把当前窗口最新现场写回既有空间快照（原地更新，空间切换用）。返回是否写入成功。 */
  updateSpace: (id: string) => Promise<boolean>;
  /**
   * 选择性恢复：只恢复勾选的条目，返回新建标签数与降级标志。
   * 勾选集为空返回 0（调用方前置条件，非失败）；快照不存在与 restore 同口径抛错。
   * 其余语义与 restore 一致（缺失才新建、分组还原、结束后按差分登记可撤销批次）。
   */
  restoreSelected: (
    id: string,
    selectedTabs: readonly SnapshotTab[]
  ) => Promise<RestoreSnapshotResult>;
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
      //
      // 用 structuralSignature 而非裸 JSON.stringify：快照族上限为
      // SNAPSHOTS_LIMIT(200) × SNAPSHOT_TABS_LIMIT(1000)，且每条标签自带
      // favIconUrl（大量站点是 base64 data URL，占单条数据绝大部分体积）。
      // 裸 stringify 会在**每次** storage 变更（关窗自动保存 / 定时快照）对
      // 整族做两次全量序列化——即 tabStore 判定过的「大标签量下每次事件的固定热点」。
      // structuralSignature 会跳过 favIconUrl，代价是「仅 favicon 变化」时延迟
      // 一次刷新（见 core/util/signature 的模块注释），下次真实变更即自愈。
      // 该守卫只影响内存回放的时机，不参与任何写盘，跳过不会造成数据丢失。
      snapshotsRepository.watch((value) => {
        if (structuralSignature(value) === structuralSignature(get().snapshots)) return;
        set({ snapshots: value });
      });
    }
    const before = get().snapshots;
    const snapshots = await snapshotsRepository.read();
    // 反向窗口：read 在途期间 background 写入（关窗自动保存），watcher 回放
    // 已把新值放进内存（引用变化）——此时以 watcher 交付为准，read 到的
    // 启动时刻旧值不得回写覆盖，只补 ready 标记。
    if (get().snapshots !== before) {
      set({ ready: true });
      return;
    }
    set({ snapshots, ready: true });
  },

  saveCurrentWindow: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryWindowGroups(tabs[0]?.windowId);
    const snapTabs = collectSnapshotTabs(tabs, groups);
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: DEFAULT_SNAPSHOT_NAMES.manual,
      origin: 'manual',
      // windowId 必须取实际采集窗口：标签来自 currentWindow 查询，而
      // getLastFocused 在多窗口场景可能指向另一个窗口，记录与实际
      // 内容不一致会让未来「恢复回原窗口」的逻辑直接出错。
      windowId: tabs[0]?.windowId,
      tabs: snapTabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
  },

  saveSpace: async (name) => {
    const tabs = await queryCurrentWindowTabs();
    const groups = await queryWindowGroups(tabs[0]?.windowId);
    const snapTabs = collectSnapshotTabs(tabs, groups);
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: DEFAULT_SNAPSHOT_NAMES.space,
      origin: 'space',
      windowId: tabs[0]?.windowId,
      tabs: snapTabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
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
        // 保存失败绝不关闭标签：归档的语义是「保存 + 关闭」，
        // 只完成后者会变成一次不可撤销的丢标签事故。此处中止，标签保持打开。
        logFailure('snapshotStore', '归档保存失败，已中止关窗，标签保持打开', error);
        throw error;
      }
    }
    // 只关闭已保存的可恢复标签：chrome:// 等内部页无法入档，保留在原窗口（不静默丢失）。
    // 用 flatMap 直接产出已收窄的 id，而不是「filter 之后再用 `tab.id!` 断言」：
    // 断言只是让编译器闭嘴，一旦 filter 条件被改动，undefined 会静默混进 tabs.remove。
    const closableIds = tabs.flatMap((tab) =>
      typeof tab.id === 'number' && tab.url && /^https?:\/\//i.test(tab.url) ? [tab.id] : []
    );
    // 若关闭后窗口将随之关闭（全部标签都已保存），提前请求跳过本次关窗自动保存，
    // 避免 background 再写一条同内容的 auto 快照。
    if (windowId !== undefined && closableIds.length > 0 && closableIds.length === tabs.length) {
      // 必须 ack：SW 休眠唤醒慢于 tabs.remove 的事件派发时，fire-and-forget 会让
      // 关窗事件先于标记落账执行，auto 快照照写（同一批标签出现 archive+auto 两条）。
      await sendMessageWithAck({ type: 'skip-auto-save-once', windowId });
    }
    if (closableIds.length > 0) {
      // 先关闭拿到实际成功 id，再按真实结果登记撤销：tabs.remove 整体失败时
      // （任一 id 在查询与关闭之间失效会整体 reject 或部分失败），若已把
      // 全部 closable 标签入栈，撤销会把从未关闭的标签再开一份——撤销从安全网
      // 变成重复标签制造机。与 closeWithUndo 的口径保持一致。
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
            // 撤销登记失败不阻断归档（快照已经落盘，数据不会丢），但必须留痕。
            logFailure('snapshotStore', '归档撤销登记失败，本次归档仅能从快照恢复', error);
          });
      }
    }
    return snapTabs.length;
  },

  importOneTab: async (text, name) => {
    const tabs = parseOneTab(text);
    if (tabs.length === 0) return 0;
    const snapshot = buildSnapshot({
      name: name ?? '',
      fallbackName: DEFAULT_SNAPSHOT_NAMES.oneTab,
      origin: 'manual',
      windowId: undefined,
      tabs
    });
    const next = await persistSnapshot(snapshot);
    set({ snapshots: next });
    return tabs.length;
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
    // 逐份落盘：每份各自走 persistSnapshot 的跨页锁 + trimSnapshotsWithEvicted 裁剪。
    // 刻意不整批塞进一次写入——快照族上限（SNAPSHOTS_LIMIT）由裁剪函数按
    // 「保留最新」语义收敛，一次性合并写入会在超上限时丢掉整批中较旧的份，
    // 而逐份写入让每份都经同一语义收敛（与用户手动逐条保存的最终态一致）。
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
    if (!trimmed) {
      // 入口（SnapshotsPanel）已先拦并提示，这里守住第二道：
      // 静默 return 会让「改了名却没生效」在诊断里完全不留痕迹。
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
   * 恢复快照。
   *
   * 恢复会一次性**新建**整批标签，必须可反悔 —— 否则用户只能手动一个个关。
   *
   * 采用方案 B：恢复完成后，把本次新建出来的标签记为一批「可关闭项」入撤销栈
   * （kind='restore'）。「撤销本次恢复」= 关闭这批标签，由 undoStore 的 restore
   * 分支执行（撤销栈的常规分支是「重新打开」，对本批次不适用 —— 它们根本没被关掉）；
   * 关闭后生成的普通关闭批次仍可再被撤销，于是能再开回来。
   *
   * 为什么不是方案 A（独立的一次性「撤销本次恢复」入口）：那需要新建一套与撤销栈
   * 平行的状态机，且无法享受既有的跨页锁、持久化与重做栈。方案 B 复用全部既有管线。
   *
   * 注意 kind 在 schema 里是 z.string()（models.ts:259），新增 'restore' 无需改 schema。
   */
  restore: async (id, windowId) => {
    const snap = get().snapshots.find((entry) => entry.id === id);
    if (!snap) {
      // 找不到快照只有两种成因（已被另一页面删除 / 列表未加载），无论哪种都不能
      // 表达成「恢复成功、新建 0 个」：调用方会据此提示「已恢复 0 个标签」，
      // 用户无从判断是快照本身为空还是压根没执行 —— 成功形状承载失败是最难查的
      // 一种谎报。抛出后由调用方既有的失败出口接管（用户提示 + 诊断留痕）。
      logDegraded('snapshotStore', `快照 ${id} 不存在，恢复未执行`);
      throw new Error(`snapshot-not-found:${id}`);
    }
    // 差分必须落在恢复的**目标窗口**上：restoreSnapshot 在 windowId 缺省时恢复到
    // 最近聚焦窗口，而侧边栏所在窗口未必是它 —— 按当前窗口取「恢复前现场」，
    // 跨窗恢复时会一个新建项都匹配不到。resolveRestoreWindowId 与 restoreSnapshot
    // 的窗口解析口径一致（指定优先，缺省回退最近聚焦）。
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
    // false = 空间已不存在或现场为空（未覆盖），调用方必须据此决定后续步骤。
    return result.replaced;
  },

  restoreSelected: async (id, selectedTabs) => {
    const snap = get().snapshots.find((entry) => entry.id === id);
    if (!snap) {
      logDegraded('snapshotStore', `快照 ${id} 不存在，选择性恢复未执行`);
      throw new Error(`snapshot-not-found:${id}`);
    }
    // 空勾选不是失败：调用方（勾选面板）本就不会在空集时发起，此处不抛错、
    // 也不谎报执行过 —— 返回 0 即「本次没有新建任何标签」的真实结果。
    if (selectedTabs.length === 0) return { count: 0, degraded: false };
    // 撤销账本与整份恢复完全同口径：勾选恢复同样是一次可新建上百标签的破坏性
    // 动作，既不走影响面确认也不登记撤销会与 restore 不对称，是安全网缺口。
    const targetWindowId = await resolveRestoreWindowId(undefined);
    const beforeIds = await captureWindowTabIds(targetWindowId);
    // 部分快照：勾选条目 + 同步重算 tabCount（满足 schema refine 约束），
    // 之后完全复用整份恢复管线（豁免/并发创建/分组还原语义不变）。
    const result = await restoreSnapshot(buildPartialSnapshot(snap, selectedTabs));
    if (result.count > 0 && beforeIds && targetWindowId !== undefined) {
      await recordRestoreForUndo(beforeIds, targetWindowId);
    }
    return result;
  },

  reset: () => set({ snapshots: [], ready: false })
}));
