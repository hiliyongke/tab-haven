import { createCoalescedWriter } from '@/platform/storage/coalescedWriter';
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
 * dataStore 共享上下文构造器。
 *
 * 把 890 行单体 store 里的「管道」逻辑（合并写入 / 降级上报 / 镜像调度 / 绑定同步 /
 * 跨页设置回放 / 分区 watcher）集中于此，供各业务切片通过 `ctx` 消费；
 * 同时在此持有导入事务互斥与 watcher 挂起两个模块级标志，避免切片间循环依赖。
 */
let importing = false;
let watchersSuspended = false;

/**
 * 有「写入成功」路径的分区各自的降级记账 scope。
 * 其余调用点（设置、折叠态、镜像恢复等）用 'dataStore' 上报，没有对应的成功回调，
 * 因此置起后不会自行复位 —— 那正是我们要的：设置没写成功就不能假装恢复了。
 */
const FOLDERS_SCOPE = 'fixed-folders';
const PINS_SCOPE = 'persistent-pins';
/** 会话绑定分区的降级记账 scope（folderSlice 的 reconcile 路径共用同一 scope）。 */
export const BINDINGS_SCOPE = 'session-bindings';

export function buildDataContext(
  set: (partial: Partial<DataState>) => void,
  get: () => DataState,
  repos: Repositories
): DataContext {
  // 写入工具：闭包内定义，用 set/get 访问 store，避免模块级声明顺序依赖（no-use-before-define）。
  // 写合并保留 DataRepository.write 的 boolean 语义，便于写失败时上报降级。
  const writeFoldersCoalesced = createCoalescedWriter<FixedFolder[], boolean>(repos.folders);
  const writePinsCoalesced = createCoalescedWriter<PersistentPin[], boolean>(repos.pins);

  /** 把最新本地数据镜像到浏览器同步通道（写合并 + 配额降级）。 */
  const scheduleMirror = (state: MirrorState): void => {
    // 开关即闸门：未开启时一次 sync 写入都不发。此前这里是无条件镜像，
    // 用户完全无感知就把完整收藏 URL 推上了浏览器账号通道。
    if (!state.settings.syncMirrorEnabled) return;
    syncMirror.schedule({ folders: state.folders, pins: state.pins, settings: state.settings });
  };

  /**
   * 处于降级状态的持久化分区。
   *
   * 按分区记账（而非一个全局布尔）是必需的：`storageDegraded` 只有一个，
   * 但写入路径有四条（folders / pins / 会话绑定 / 设置等）。若「任一分区写成功就复位
   * 全局标志」，一次 settings 写失败会被随后一次 folders 写成功悄悄抹掉 —— 用户看到
   * 横幅消失，实际设置从未保存。记账后只有**所有**分区都恢复，横幅才消失。
   */
  const degradedScopes = new Set<string>();

  /**
   * 持久化失败统一上报：置起 storageDegraded 供 UI 提示，并写入诊断日志。
   * 禁止在写入失败后继续展示成功——「界面显示成功但重启即丢失」是信任事故。
   */
  function reportPersistenceFailure(scope: string, message: string): void {
    degradedScopes.add(scope);
    if (!get().storageDegraded) set({ storageDegraded: true });
    logDegraded(scope, message);
  }

  /**
   * 某分区写入成功：只清除它自己的降级记录。
   * 仍保留「成功即复位」的语义（quota 抖动恢复后告警要消失），但不再连坐其他分区。
   */
  function clearDegraded(scope: string): void {
    if (!degradedScopes.delete(scope)) return;
    if (degradedScopes.size === 0 && get().storageDegraded) set({ storageDegraded: false });
  }

  /** 清空全部降级记账（数据已被整体清除，此前的失败不再有对应数据）。 */
  function resetDegraded(): void {
    degradedScopes.clear();
    if (get().storageDegraded) set({ storageDegraded: false });
  }

  async function writeFolders(folders: FixedFolder[]): Promise<void> {
    // 导入事务进行中：高频拖拽写入挂起，避免与导入的串行写交错、把导入结果覆盖回旧值。
    // 内存态由 importData 统一提交，此处直接放弃落盘与镜像。
    if (importing) {
      // 丢弃必须可观测：否则表现为「拖了没反应」，且诊断里查不到原因。
      logDegraded('dataStore', '导入事务进行中，本次固定空间写入已丢弃（内存态不更新）');
      return;
    }
    // 先更新内存态（UI 即时响应），storage 落盘合并为最终值。
    set({ folders });
    const ok = await writeFoldersCoalesced(folders);
    // 落盘失败不回滚内存态（重排/新增等高频操作回滚会造成界面跳动），
    // 但必须置起降级标志，让 UI 明确告知「可能未保存」而不是假装成功。
    if (ok === false) {
      reportPersistenceFailure(FOLDERS_SCOPE, '固定文件夹写入失败，重启后可能丢失本次改动');
    } else {
      // 写入成功证明该分区已恢复（如 quota 抖动后回到可用）。
      clearDegraded(FOLDERS_SCOPE);
    }
    // 本地落盘失败时不镜像：否则会把未落盘的内存态推上 sync，造成 local/sync 终态不一致。
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

  async function writePins(pins: PersistentPin[]): Promise<void> {
    // 导入事务进行中：挂起落盘与镜像，内存态由 importData 统一提交。
    if (importing) {
      logDegraded('dataStore', '导入事务进行中，本次固定图标写入已丢弃（内存态不更新）');
      return;
    }
    set({ pins });
    const ok = await writePinsCoalesced(pins);
    if (ok === false) {
      reportPersistenceFailure(PINS_SCOPE, '固定图标写入失败，重启后可能丢失本次改动');
    } else {
      clearDegraded(PINS_SCOPE);
    }
    if (ok !== false) scheduleMirror(get());
  }

  // 跨页面设置同步：设置页 / 侧边栏 / popup 各自持有独立 dataStore 实例，
  // 通过 storage.onChanged 感知其他页面写入的设置并实时应用（否则改完设置需重开面板才生效）。
  // 另提供 refreshSettings（重新读存储）与 settings-synced 广播消息作为双保险。
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
      // 读取失败保持当前状态
      console.warn('[dataStore] settings replay read failed; keeping current settings', error);
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
    repos.settings.watch(() => void syncSettingsFromStorage());
  };

  /**
   * 数据分区 watcher（folders / pins / collapse）。
   *
   * 守卫是必需的：`initialize` 失败时会回滚 `initialized` 允许重入，若无守卫则
   * 每次重试都再注册三个监听器 —— 同一次变更被回放 N 次，表现为界面闪烁与重复写盘。
   */
  const startValueWatchers = (): void => {
    if (valueWatchersStarted) return;
    valueWatchersStarted = true;
    // 回显守卫：本页面自身写入触发的 watch 回放内容相同，直接跳过，避免双倍渲染。
    repos.folders.watch((value) => {
      if (watchersSuspended) return;
      if (structuralSignature(value) === structuralSignature(get().folders)) return;
      set({ folders: value });
    });
    repos.pins.watch((value) => {
      if (watchersSuspended) return;
      const next = dedupePins(value);
      if (structuralSignature(next) === structuralSignature(get().pins)) return;
      set({ pins: next });
    });
    repos.collapse.watch((value) => {
      if (watchersSuspended) return;
      if (structuralSignature(value) === structuralSignature(get().collapsedSites)) return;
      set({ collapsedSites: value });
    });
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
    applyBindings,
    syncSettingsFromStorage,
    broadcastSettingsSynced,
    startSettingsWatcher,
    startValueWatchers,
    isImporting: () => importing,
    setImporting: (value) => {
      importing = value;
    },
    setWatchersSuspended: (value) => {
      watchersSuspended = value;
    }
  };
}
