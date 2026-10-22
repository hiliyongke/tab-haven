import type {
  ExportFile,
  FixedFolder,
  PersistentPin,
  Settings,
  SiteCollapseState
} from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import type { MutateSessionResult } from '@/platform/storage/session';
import type { MirrorSyncIssue } from '@/platform/storage/SyncMirror';
import type { Repositories } from '@/platform/registry';

/** 拖标签/分组进入文件夹的落位结果计数。对外导出供 UI 层组织反馈文案。 */
export interface AddTabsToFolderResult {
  added: number;
  moved: number;
  skipped: number;
}

/** 写入通知镜像所需的精简状态切片。 */
export interface MirrorState {
  folders: FixedFolder[];
  pins: PersistentPin[];
  settings: Settings;
}

/**
 * dataStore 切片共享上下文：封装 set/get、仓库集合与写入/降级/监视器等公共逻辑。
 * 各切片（folder/pins/settings/transfer/init）只消费 ctx，不直接触碰浏览器 API 或模块级状态，
 * 从而把 890 行单体 store 拆成可独立审阅的小模块，且不改变 store 对外接口。
 */
export interface DataContext {
  set: (partial: Partial<DataState>) => void;
  get: () => DataState;
  repos: Repositories;
  /**
   * 写入 folders 分区。直写值或 updater：
   * updater 在写前一刻以最新内存态重算（get→算→set 之间无 await），
   * 消除「入口取基线 → 中途 await → 旧基线整表回写」的并发互覆窗口。
   * 复合操作（读-算-写）必须用 updater 形态。
   */
  writeFolders: (
    folders: FixedFolder[] | ((current: FixedFolder[]) => FixedFolder[])
  ) => Promise<void>;
  /** 同 writeFolders 的 updater 双形态（见上）。 */
  writePins: (
    pins: PersistentPin[] | ((current: PersistentPin[]) => PersistentPin[])
  ) => Promise<void>;
  /** 丢弃排队的合并写入并等待在途批次结束；返回后写入器空闲，供清空/导入前防旧值回写。 */
  cancelWrites: () => Promise<void>;
  scheduleMirror: (state: MirrorState) => void;
  reportPersistenceFailure: (scope: string, message: string) => void;
  /** 某分区写入成功：只清除它自己的降级记录（所有分区恢复后横幅才消失）。 */
  clearDegraded: (scope: string) => void;
  /** 清空全部降级记账（整体清除数据后调用，历史失败不再有对应数据）。 */
  resetDegraded: () => void;
  /** 复位镜像失败态（关闭同步 / 清空数据后调用：此后不再有镜像写入，回调不会再来）。 */
  resetMirrorFailure: () => void;
  applyBindings: (result: MutateSessionResult) => void;
  syncSettingsFromStorage: () => Promise<void>;
  broadcastSettingsSynced: () => void;
  startSettingsWatcher: () => void;
  startValueWatchers: () => void;
  isImporting: () => boolean;
  setImporting: (value: boolean) => void;
  /** 清空事务是否进行中（与导入事务互斥，见 clearAllData / importData）。 */
  isClearing: () => boolean;
  setClearing: (value: boolean) => void;
  setWatchersSuspended: (value: boolean) => void;
}

interface DataState {
  folders: FixedFolder[];
  pins: PersistentPin[];
  collapsedSites: SiteCollapseState;
  settings: Settings;
  /** 绑定到固定条目的标签 id（从临时区排除）。 */
  boundTabIds: number[];
  /**
   * 持久化是否已降级（会话/本地存储写入失败）。
   * 为 true 时 UI 应提示用户数据可能未保存，而不是静默继续。
   */
  storageDegraded: boolean;
  /**
   * 最近一次镜像拉取的结果分类。
   *
   * 与 storageDegraded 区分开：后者是「本地写入失败」，这里是「云端镜像没生效」——
   * 本地数据完好，但换机后恢复不到。只在诊断里留痕时设置页没有任何呈现，
   * 表现为「开启了同步，换机后什么都没有」且无从排查。
   *
   * 存分类而非布尔值：布尔只能表达「坏 / 不坏」，于是「分块超限」「镜像损坏」
   * 「从未同步过」三种成因被压成同一句提示——损坏会被说成超限，而从未同步过
   * 反而显示「已生效」。null = 本次会话尚未拉取过（已 seeded 的设备不会拉取）。
   */
  mirrorIssue: MirrorSyncIssue | null;
  /**
   * 最近一次镜像**写入**是否失败。
   *
   * 与 `mirrorIssue` 必须分开：后者是「镜像能不能读到」（可恢复性），这里是
   * 「本机改动有没有上传」（新鲜度）。二者可以是任意组合——写失败时云端留着
   * 上一次的旧镜像，pull 照样成功，于是只看 pull 分类会得到「已生效」，
   * 而其他设备根本收不到本次改动（容量超限等故障正是这个形态）。
   */
  mirrorWriteFailed: boolean;
  /**
   * 导入事务是否进行中。
   *
   * 期间固定空间的写入会被**有意丢弃**（避免与事务的串行写交错），因此必须让 UI 可见：
   * 否则用户拖了没反应，只会以为扩展卡了。拖拽入口据此直接拒绝并提示。
   */
  importing: boolean;
  ready: boolean;

  /** 加载全部数据并订阅变更。 */
  initialize: () => Promise<void>;

  createFolder: (name: string) => Promise<FixedFolder>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  toggleFolderCollapsed: (folderId: string) => Promise<void>;
  /** 将一组标签拖入文件夹（URL 全局唯一）。 */
  addTabsToFolder: (tabs: readonly TabRecord[], folderId: string) => Promise<AddTabsToFolderResult>;
  removeFolderItem: (folderId: string, itemId: string) => Promise<void>;
  /**
   * 整体写回 folders —— 排序类与删除类操作的一次性回滚入口。
   *
   * 固定空间是长期资产，而拖拽 4px 即激活（PointerSensor distance:4）且落点检测
   * 永不返回空，误拖必然产生真实变更；删除文件夹/移出条目同样必须有回退点。
   * 调用方在操作前留一份快照，成功后通过 toast 的 action 调本方法回滚。
   *
   * 走 writeFolders 的**直值**形态而非 updater：回滚要的是「回到这个确定的值」，
   * 不能被并发的其他写入再算一次。
   */
  restoreFolders: (snapshot: readonly FixedFolder[]) => Promise<void>;
  reorderFolderItems: (op: {
    folderId: string;
    sourceId: string;
    targetId: string;
    placeAfter: boolean;
  }) => Promise<void>;
  moveFolder: (sourceId: string, targetId: string, placeAfter: boolean) => Promise<void>;
  /** 固定条目跨文件夹移动（URL 全局唯一约束下）。 */
  moveFolderItem: (sourceFolderId: string, itemId: string, targetFolderId: string) => Promise<void>;
  /** 打开固定条目（挂起/绑定/精确匹配/新建 四级）。 */
  openSavedItem: (item: { id: string; url?: string; pendingTabId?: number }) => Promise<void>;
  /** 从原生组保存为固定文件夹（去重 + 建立绑定）。 */
  /** 把原生组保存为固定文件夹；无可收藏条目时返回 false（不建空夹），成功返回 true。 */
  createFolderFromNativeGroup: (name: string, groupTabs: readonly TabRecord[]) => Promise<boolean>;
  /** 将固定文件夹恢复为原生标签组，并移除已转换的固定文件夹。 */
  syncFolderToNativeGroup: (folderId: string) => Promise<boolean>;

  /**
   * 固定为常驻磁贴；返回**是否真的固定成功**。
   *
   * 返回值而非 `Promise<void>`：本操作存在多条「无法满足」的分支（标签无 URL、
   * 非 http(s)、已达上限），它们过去是静默 return，而 Promise 照常 resolve ——
   * 调用方于是照常弹出「已固定标签」，界面宣布成功而磁贴从未生成。
   * 是否成功必须由调用方拿到，不能靠猜。
   */
  addPin: (tab: TabRecord) => Promise<boolean>;
  removePin: (pin: PersistentPin) => Promise<void>;
  reorderPins: (sourceId: string, targetId: string, placeAfter: boolean) => Promise<void>;
  openPin: (pin: PersistentPin) => Promise<void>;

  /** 设置站点分组折叠状态（持久化）。 */
  toggleSiteCollapsed: (siteKey: string, collapsed: boolean) => Promise<void>;
  updateSettings: (partial: Partial<Settings>) => Promise<void>;
  /**
   * updateSettings 的 UI 安全变体：吞掉失败并返回是否生效。
   *
   * updateSettings 在「schema 校验失败」与「落盘失败」时都 throw，而 UI 调用点
   * 大多是 `void updateSettings(...)`——既得不到失败信号，又留下未捕获的 rejection。
   * 失败本身已由 reportPersistenceFailure 置起 storageDegraded，这里只负责让
   * 调用方不必层层 try/catch，也不至于产生 unhandled rejection。
   */
  tryUpdateSettings: (partial: Partial<Settings>) => Promise<boolean>;
  /** 恢复全部设置为默认值。 */
  resetSettings: () => Promise<void>;
  /** 清除所有本地数据（不可恢复）：仓库 + 会话存储 + 跨设备镜像，内存态重置为默认。 */
  clearAllData: () => Promise<void>;
  /** 重新从存储读取设置并应用到 store（跨页面同步兜底）。 */
  refreshSettings: () => Promise<void>;
  /**
   * 导出完整备份（固定空间 + 设置 + 全部快照族），不包含当前打开标签或撤销栈。
   * 异步：快照直读仓库，不依赖任何页面是否加载过 snapshotStore。
   */
  exportData: () => Promise<ExportFile>;
  /** 校验并覆盖导入备份（事务），不触碰当前打开标签。 */
  importData: (raw: unknown) => Promise<void>;
  /** 从书签栏导入固定文件夹（同名合并，URL 全局去重）。 */
  importBookmarksFromBar: () => Promise<{ foldersCreated: number; itemsImported: number }>;

  /** 快照联动：挂起转正 + 绑定维护（由 tabStore 每次刷新后调用）。 */
  reconcileWithTabs: (tabs: readonly TabRecord[]) => Promise<void>;
}

export type { DataState };
