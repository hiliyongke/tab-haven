import { createCoalescedWriter } from '@/core/util/coalescedWriter';
import {
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  withCrossPageLock
} from '@/platform/storage/crossPageLock';
import { syncMirror } from '@/platform/storage/SyncMirror';
import { logDegraded } from '@/platform/diagnostics';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import { sendMessage } from '@/platform/messages';
import { structuralSignature } from '@/core/util/signature';
import { dedupePins } from '@/core/fixed/FolderOps';
import { type FixedFolder, type PersistentPin } from '@/core/schema/models';
import type { Repositories } from '@/platform/registry';
import type { MutateSessionResult } from '@/platform/storage/session';
import type { DataContext, DataState, MirrorState } from './types';

/**
 * dataStore 共享上下文构造器：把合并写入 / 降级上报 / 镜像调度 / 绑定同步 / 跨页设置回放 /
 * 分区 watcher 集中于此，供各切片通过 `ctx` 消费；并持有导入事务互斥与 watcher 挂起两个模块级标志，
 * 避免切片间循环依赖。
 */
let importing = false;
let watchersSuspended = false;
/** 清空事务进行中：与导入事务互斥（导入进行中点清空会把已清空的存储回填）。 */
let clearing = false;
/**
 * 导入期间「写入被丢弃」已留痕的分区（本会话内只留一次）：导入事务持续数百 ms，
 * 期间连续拖拽触发大量 writeFolders，逐次留痕会用同一句文案刷满诊断缓冲、把真故障挤出去。
 */
const importDropLogged = new Set<string>();
/** 已注册 watcher 的退订函数。运行时不退订（watcher 即跨页同步通道），只在 HMR 重载时统一执行。 */
const watcherUnsubscribers: Array<() => void> = [];

/**
 * 有「写入成功」路径的分区各自的降级记账 scope。
 * 其余调用点（设置、折叠态、镜像恢复等）用 'dataStore' 上报，没有成功回调、不会自行复位：
 * 设置没写成功就不能假装恢复。
 */
const FOLDERS_SCOPE = 'fixed-folders';
const PINS_SCOPE = 'persistent-pins';
/** 会话绑定分区的降级记账 scope（folderSlice 的 reconcile 路径共用同一 scope）。 */
export const BINDINGS_SCOPE = 'session-bindings';
/** 跨设备同步镜像的降级记账 scope（镜像失败不影响本地，但要让用户看见）。 */
const SYNC_MIRROR_SCOPE = 'sync-mirror';

export function buildDataContext(
  set: (partial: Partial<DataState>) => void,
  get: () => DataState,
  repos: Repositories
): DataContext {
  // 写入工具在闭包内定义，用 set/get 访问 store，避免模块级声明顺序依赖。
  // 写合并保留 DataRepository.write 的 boolean 语义，便于写失败时上报降级。
  // 落盘经跨页锁：background 右键菜单的 RMW 与面板「末值落盘」交错会互相覆盖（静默丢条目）。
  /**
   * 落盘通道：写「本页内存算好的整表」，锁只负责与增量写方串行化。
   * 不能改成「锁内以磁盘为基线重算」：合并窗口内可能排了多次变更（createFolder → addTabsToFolder），
   * 磁盘此时还没有前一次结果，拿它当基线会把排队中的改动抹掉。
   */
  const writeFoldersCoalesced = createCoalescedWriter<FixedFolder[], boolean>({
    write: (value) => withCrossPageLock(FOLDERS_RMW_LOCK, () => repos.folders.write(value))
  });
  const writePinsCoalesced = createCoalescedWriter<PersistentPin[], boolean>({
    write: (value) => withCrossPageLock(PINS_RMW_LOCK, () => repos.pins.write(value))
  });

  /**
   * 镜像写结果回执：失败置起降级横幅、成功清掉。
   * 镜像走浏览器账号通道，失败时本地数据不受影响，正因如此极易被做成静默——
   * 这里让它与本地落盘失败共用「持久化失败必须可见」的纪律（scope 独立，不被其它分区连坐清除）。
   */
  syncMirror.setMirrorResultHandlers({
    onFailure: (message, reason) => {
      reportPersistenceFailure(SYNC_MIRROR_SCOPE, message);
      // 同步状态行须反映写结果：配额超限等故障下云端仍留旧镜像，pull 分类保持 'ok' 会显示「已生效」。
      if (!get().mirrorWriteFailed) set({ mirrorWriteFailed: true });
      // 配额超限是确定性故障（重试只会撞配额），UI 要显示「未生效（超出同步容量上限）」，
      // 且这是用户可自行处理的（删固定条目），不能与普通写失败压成一档。
      const quotaExceeded = reason === 'quota';
      if (get().mirrorQuotaExceeded !== quotaExceeded) set({ mirrorQuotaExceeded: quotaExceeded });
    },
    onSuccess: () => {
      clearDegraded(SYNC_MIRROR_SCOPE);
      if (get().mirrorWriteFailed) set({ mirrorWriteFailed: false });
      if (get().mirrorQuotaExceeded) set({ mirrorQuotaExceeded: false });
    }
  });

  /** 把最新本地数据镜像到浏览器同步通道（写合并 + 配额降级）。 */
  const scheduleMirror = (state: MirrorState): void => {
    // 开关即闸门：未开启时一次 sync 写入都不发，否则会在用户无感知下把收藏 URL 推上账号通道。
    if (!state.settings.syncMirrorEnabled) return;
    syncMirror.schedule({ folders: state.folders, pins: state.pins, settings: state.settings });
  };

  /**
   * 处于降级状态的持久化分区。按分区记账（而非全局布尔）是必需的：写入路径有四条，
   * 若「任一分区写成功就复位全局标志」，一次 settings 写失败会被随后 folders 写成功悄悄抹掉。
   * 记账后只有**所有**分区都恢复，横幅才消失。
   */
  const degradedScopes = new Set<string>();

  /**
   * 持久化失败统一上报：置起 storageDegraded 供 UI 提示并写入诊断日志。
   * 写入失败后禁止继续展示成功——「界面显示成功但重启即丢失」是信任事故。
   */
  function reportPersistenceFailure(scope: string, message: string): void {
    degradedScopes.add(scope);
    if (!get().storageDegraded) set({ storageDegraded: true });
    logDegraded(scope, message);
  }

  /**
   * 某分区写入成功：只清除它自己的降级记录（quota 抖动恢复后告警要消失），但不连坐其他分区。
   */
  function clearDegraded(scope: string): void {
    if (!degradedScopes.delete(scope)) return;
    if (degradedScopes.size === 0 && get().storageDegraded) set({ storageDegraded: false });
  }

  /** 清空全部降级记账（数据已被整体清除，已记录的失败不再有对应数据）。 */
  function resetDegraded(): void {
    degradedScopes.clear();
    if (get().storageDegraded) set({ storageDegraded: false });
  }

  /**
   * 复位镜像失败态（关闭同步 / 清空数据时调用）：镜像降级只由 onSuccess 复位，关闭同步后不再有
   * 镜像写入、该回调永不到来，不显式复位会让横幅与 mirrorWriteFailed 永久粘住。
   */
  function resetMirrorFailure(): void {
    clearDegraded(SYNC_MIRROR_SCOPE);
    if (get().mirrorWriteFailed) set({ mirrorWriteFailed: false });
    if (get().mirrorQuotaExceeded) set({ mirrorQuotaExceeded: false });
  }

  async function writeFolders(
    arg: FixedFolder[] | ((current: FixedFolder[]) => FixedFolder[])
  ): Promise<void> {
    // 导入事务进行中：高频拖拽写入挂起，避免与导入的串行写交错覆盖导入结果；内存态由 importData 统一提交。
    if (importing) {
      // 丢弃必须可观测，但同一原因本会话只留一次（见 importDropLogged），否则刷满诊断缓冲。
      if (!importDropLogged.has(FOLDERS_SCOPE)) {
        importDropLogged.add(FOLDERS_SCOPE);
        logDegraded('dataStore', '导入事务进行中，本次固定空间写入已丢弃（内存态不更新）');
      }
      return;
    }
    // updater 形态在执行这一刻取最新基线重算：get→算→set 无 await 间隙，入口基线过期互覆窗口归零。
    const folders = typeof arg === 'function' ? arg(get().folders) : arg;
    // 先更新内存态（UI 即时响应），storage 落盘合并为最终值。
    set({ folders });
    const ok = await writeFoldersCoalesced(folders);
    // 落盘失败不回滚内存态（高频操作回滚会造成界面跳动），但必须置起降级标志。
    if (ok === false) {
      reportPersistenceFailure(FOLDERS_SCOPE, '固定文件夹写入失败，重启后可能丢失本次改动');
    } else {
      // 写入成功证明该分区已恢复（如 quota 抖动后回到可用）。
      clearDegraded(FOLDERS_SCOPE);
    }
    // 本地落盘失败时不镜像：否则把未落盘的内存态推上 sync，造成 local/sync 终态不一致。
    if (ok !== false) scheduleMirror(get());
  }

  /** 应用会话变更结果并同步绑定集合。persisted 为 false 时置起 storageDegraded 供 UI 提示。 */
  function applyBindings(result: MutateSessionResult): void {
    set({ boundTabIds: Object.values(result.data.itemTabBindings) });
    if (!result.persisted) {
      reportPersistenceFailure(BINDINGS_SCOPE, '会话绑定未能持久化，面板重启后挂起条目绑定将丢失');
    } else {
      clearDegraded(BINDINGS_SCOPE);
    }
  }

  async function writePins(
    arg: PersistentPin[] | ((current: PersistentPin[]) => PersistentPin[])
  ): Promise<void> {
    // 导入事务进行中：挂起落盘与镜像，内存态由 importData 统一提交。
    if (importing) {
      // 同 writeFolders：同一原因本会话内只留一次（见 importDropLogged）。
      if (!importDropLogged.has(PINS_SCOPE)) {
        importDropLogged.add(PINS_SCOPE);
        logDegraded('dataStore', '导入事务进行中，本次固定图标写入已丢弃（内存态不更新）');
      }
      return;
    }
    const pins = typeof arg === 'function' ? arg(get().pins) : arg;
    set({ pins });
    const ok = await writePinsCoalesced(pins);
    if (ok === false) {
      reportPersistenceFailure(PINS_SCOPE, '固定图标写入失败，重启后可能丢失本次改动');
    } else {
      clearDegraded(PINS_SCOPE);
    }
    if (ok !== false) scheduleMirror(get());
  }

  // 跨页面设置同步：设置页与侧边栏各自持有独立 dataStore 实例，通过 storage.onChanged
  // 感知其他页面写入的设置并实时应用；另提供 refreshSettings 与 settings-synced 广播作为双保险。
  const syncSettingsFromStorage = async (): Promise<void> => {
    // 导入事务进行中：内存态由事务统一提交，watcher 不得插手。
    if (watchersSuspended) return;
    try {
      const next = await repos.settings.read();
      // 回显守卫：本页面自身写入触发的回放内容相同，跳过 set 避免双倍渲染。
      if (structuralSignature(next) !== structuralSignature(get().settings))
        set({ settings: next });
      applyTheme(next.themePreference, next.colorTheme);
    } catch (error) {
      // 读取失败保持当前状态，且必须走诊断管道而非 console.warn（后者无法被「导出诊断」读到）。
      logDegraded('dataStore', '设置回读失败，保持当前设置', error);
    }
  };
  const broadcastSettingsSynced = (): void => {
    sendMessage({ type: 'settings-synced' });
  };
  let settingsWatcherStarted = false;
  let valueWatchersStarted = false;
  const startSettingsWatcher = (): void => {
    if (settingsWatcherStarted) return;
    settingsWatcherStarted = true;
    watcherUnsubscribers.push(repos.settings.watch(() => void syncSettingsFromStorage()));
  };

  /**
   * 数据分区 watcher（folders / pins / collapse）。守卫是必需的：initialize 失败会回滚 initialized
   * 允许重入，若无守卫每次重试都再注册三个监听器，同一次变更被回放 N 次（界面闪烁 + 重复写盘）。
   */
  const startValueWatchers = (): void => {
    if (valueWatchersStarted) return;
    valueWatchersStarted = true;
    // 回显守卫：本页面自身写入触发的 watch 回放内容相同，直接跳过，避免双倍渲染。
    watcherUnsubscribers.push(
      repos.folders.watch((value) => {
        if (watchersSuspended) return;
        if (structuralSignature(value) === structuralSignature(get().folders)) return;
        set({ folders: value });
      }),
      repos.pins.watch((value) => {
        if (watchersSuspended) return;
        const next = dedupePins(value);
        if (structuralSignature(next) === structuralSignature(get().pins)) return;
        set({ pins: next });
      }),
      repos.collapse.watch((value) => {
        if (watchersSuspended) return;
        if (structuralSignature(value) === structuralSignature(get().collapsedSites)) return;
        set({ collapsedSites: value });
      })
    );
    // 设置变更由 startSettingsWatcher 统一处理（重读 + 主题应用），不再重复 watch。
  };

  /**
   * 丢弃排队的合并写入并等待在途批次结束，返回后两个写入器均处于空闲态。
   * 供 clearAllData / importData 在「停止世界」前调用，防止旧 folders/pins 被回写覆盖清空/导入结果。
   */
  const cancelWrites = async (): Promise<void> => {
    await Promise.all([writeFoldersCoalesced.cancel(), writePinsCoalesced.cancel()]);
  };

  return {
    set,
    get,
    repos,
    writeFolders,
    writePins,
    cancelWrites,
    scheduleMirror,
    reportPersistenceFailure,
    clearDegraded,
    resetDegraded,
    resetMirrorFailure,
    applyBindings,
    syncSettingsFromStorage,
    broadcastSettingsSynced,
    startSettingsWatcher,
    startValueWatchers,
    isImporting: () => importing,
    setImporting: (value) => {
      importing = value;
    },
    isClearing: () => clearing,
    setClearing: (value) => {
      clearing = value;
    },
    setWatchersSuspended: (value) => {
      watchersSuspended = value;
    }
  };
}

// HMR 重载时退订 watcher：模块级守卫随重载重置，旧监听器却仍挂在 storage.onChanged 上并写回旧值。
import.meta.hot?.dispose(() => {
  for (const unsubscribe of watcherUnsubscribers) unsubscribe();
  watcherUnsubscribers.length = 0;
});
