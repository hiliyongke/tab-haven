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

/** 拖标签/分组进入文件夹的落位结果计数，供 UI 组织反馈文案。 */
export interface AddTabsToFolderResult {
  added: number;
  moved: number;
  skipped: number;
}

/** 切片用精确 Pick 声明所提供的 DataState 键，展开完备性由编译器兜住（漏 spread 即编译报错）。 */
export type DataSlice<K extends keyof DataState> = Pick<DataState, K>;

export interface MirrorState {
  folders: FixedFolder[];
  pins: PersistentPin[];
  settings: Settings;
}

/** 切片共享上下文：封装 set/get、仓库与写入/降级/监视；切片只消费 ctx，不直接触碰浏览器 API。 */
export interface DataContext {
  set: (partial: Partial<DataState>) => void;
  get: () => DataState;
  repos: Repositories;
  /** 写 folders 分区并返回是否落盘。updater 在写前一刻以最新内存态重算（get→算→set 无 await）；读-算-写必须用 updater。 */
  writeFolders: (
    folders: FixedFolder[] | ((current: FixedFolder[]) => FixedFolder[])
  ) => Promise<boolean>;
  /** 同 writeFolders 的 updater 双形态。 */
  writePins: (
    pins: PersistentPin[] | ((current: PersistentPin[]) => PersistentPin[])
  ) => Promise<void>;
  /** 丢弃排队的合并写入并等待在途批次结束；返回后写入器空闲，供清空/导入前防旧值回写。 */
  cancelWrites: () => Promise<void>;
  scheduleMirror: (state: MirrorState) => void;
  /** 首次镜像恢复待完成期间禁止一切同步写，防止残缺本地态覆盖旧镜像。 */
  setMirrorRestorePending: (value: boolean) => void;
  reportPersistenceFailure: (scope: string, message: string) => void;
  /** 某分区写入成功：只清除它自己的降级记录（所有分区恢复后横幅才消失）。 */
  clearDegraded: (scope: string) => void;
  /** 整体清除数据后清空降级记账；失败记录不再对应现存数据。 */
  resetDegraded: () => void;
  /** 关闭同步或清空数据后清除镜像失败态。 */
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
  /** 持久化是否已降级（会话/本地存储写入失败）；true 时 UI 应提示数据可能未保存。 */
  storageDegraded: boolean;
  /** 最近一次镜像拉取结果分类（云端镜像没生效，区别于本地写失败的 storageDegraded）。存分类以区分分块超限/镜像损坏/从未同步；null = 本会话未拉取。 */
  mirrorIssue: MirrorSyncIssue | null;
  /** 最近一次镜像写入是否失败。与 mirrorIssue（能否读到）分开：写失败时云端留旧镜像、pull 仍成功，只看 pull 会误判已生效。 */
  mirrorWriteFailed: boolean;
  /** 镜像写失败是否因超出同步容量上限。配额超限是确定性故障（重试无用）且用户可删条目自救；压成一档则 UI 无法给出 PRIVACY.md 承诺的提示。 */
  mirrorQuotaExceeded: boolean;
  /** 导入事务进行中：期间固定空间写入被有意丢弃，故须让 UI 可见、拖拽入口据此拒绝。 */
  importing: boolean;
  ready: boolean;

  initialize: () => Promise<void>;

  /** 新建文件夹；达到上限时返回 null（返回同形态对象会让调用方误以为已创建）。 */
  createFolder: (name: string) => Promise<FixedFolder | null>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  toggleFolderCollapsed: (folderId: string) => Promise<void>;
  /** 将一组标签拖入文件夹（URL 全局唯一）。 */
  addTabsToFolder: (tabs: readonly TabRecord[], folderId: string) => Promise<AddTabsToFolderResult>;
  removeFolderItem: (folderId: string, itemId: string) => Promise<void>;
  /** 排序/删除类操作的一次性回滚入口（操作前留快照，成功后经 toast action 调用）。走 writeFolders 直值形态而非 updater：回滚要回到确定值，不能被并发再算。 */
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
  /** 把原生组保存为固定文件夹；无可收藏条目时返回 false（不建空夹），成功返回 true。 */
  createFolderFromNativeGroup: (name: string, groupTabs: readonly TabRecord[]) => Promise<boolean>;
  /** 将固定文件夹恢复为原生标签组，并移除已转换的固定文件夹。 */
  syncFolderToNativeGroup: (folderId: string) => Promise<boolean>;

  /** 固定为常驻磁贴；返回**是否真的固定成功**（无 URL / 非 http(s) / 已达上限等分支返回 false，供 UI 反馈）。 */
  addPin: (tab: TabRecord) => Promise<boolean>;
  removePin: (pin: PersistentPin) => Promise<void>;
  reorderPins: (sourceId: string, targetId: string, placeAfter: boolean) => Promise<void>;
  openPin: (pin: PersistentPin) => Promise<void>;

  toggleSiteCollapsed: (siteKey: string, collapsed: boolean) => Promise<void>;
  updateSettings: (partial: Partial<Settings>) => Promise<void>;
  /** updateSettings 的 UI 安全变体：校验/落盘失败时吞掉并返回是否生效（失败已置起 storageDegraded），免调用方层层 try/catch 与 unhandled rejection。 */
  tryUpdateSettings: (partial: Partial<Settings>) => Promise<boolean>;
  resetSettings: () => Promise<void>;
  /** 清除所有本地数据（不可恢复）：仓库 + 会话存储 + 跨设备镜像，内存态重置为默认。 */
  clearAllData: () => Promise<void>;
  /** 重新从存储读取设置并应用到 store（跨页面同步兜底）。 */
  refreshSettings: () => Promise<void>;
  /** 导出完整备份（固定空间 + 设置 + 全部快照族），不含当前标签或撤销栈；快照直读仓库，不依赖页面加载过 snapshotStore。 */
  exportData: () => Promise<ExportFile>;
  /** 校验并覆盖导入备份（事务），不触碰当前打开标签。 */
  importData: (raw: unknown) => Promise<void>;
  /** 从书签栏导入固定文件夹（同名合并，URL 全局去重）。 */
  importBookmarksFromBar: () => Promise<{ foldersCreated: number; itemsImported: number }>;

  /** 快照联动：挂起转正 + 绑定维护（由 tabStore 每次刷新后调用）。 */
  reconcileWithTabs: (tabs: readonly TabRecord[]) => Promise<void>;
}

export type { DataState };
