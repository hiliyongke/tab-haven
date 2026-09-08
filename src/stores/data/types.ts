import type {
  ExportFile,
  FixedFolder,
  PersistentPin,
  Settings,
  SiteCollapseState
} from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import type { MutateSessionResult } from '@/platform/storage/session';
import type { Repositories } from '@/platform/registry';

/** 拖标签/分组进入收藏夹的落位结果计数。对外导出供 UI 层组织反馈文案。 */
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
  writeFolders: (folders: FixedFolder[]) => Promise<void>;
  writePins: (pins: PersistentPin[]) => Promise<void>;
  /** 丢弃排队的合并写入并等待在途批次结束；返回后写入器空闲，供清空/导入前防旧值回写。 */
  cancelWrites: () => Promise<void>;
  scheduleMirror: (state: MirrorState) => void;
  reportPersistenceFailure: (scope: string, message: string) => void;
  /** 清空全部降级记账（整体清除数据后调用，历史失败不再有对应数据）。 */
  resetDegraded: () => void;
  applyBindings: (result: MutateSessionResult) => void;
  syncSettingsFromStorage: () => Promise<void>;
  broadcastSettingsSynced: () => void;
  startSettingsWatcher: () => void;
  startValueWatchers: () => void;
  isImporting: () => boolean;
  setImporting: (value: boolean) => void;
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
  reorderFolderItems: (op: {
    folderId: string;
    sourceId: string;
    targetId: string;
    placeAfter: boolean;
  }) => Promise<void>;
  /** 文件夹排序。 */
  moveFolder: (sourceId: string, targetId: string, placeAfter: boolean) => Promise<void>;
  /** 固定条目跨文件夹移动（URL 全局唯一约束下）。 */
  moveFolderItem: (sourceFolderId: string, itemId: string, targetFolderId: string) => Promise<void>;
  /** 打开固定条目（挂起/绑定/精确匹配/新建 四级）。 */
  openSavedItem: (item: { id: string; url?: string; pendingTabId?: number }) => Promise<void>;
  /** 从原生组保存为固定文件夹（去重 + 建立绑定）。 */
  createFolderFromNativeGroup: (name: string, groupTabs: readonly TabRecord[]) => Promise<void>;
  /** 将固定文件夹恢复为原生标签组，并移除已转换的固定文件夹。 */
  syncFolderToNativeGroup: (folderId: string) => Promise<boolean>;

  addPin: (tab: TabRecord) => Promise<void>;
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
