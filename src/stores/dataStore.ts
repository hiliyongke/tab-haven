import { create } from 'zustand';
import { browser } from 'wxt/browser';
import i18n from '@/i18n';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import {
  createFolder as createFolderModel,
  createFolderItem,
  dedupePins,
  pinFromTab,
  reorderPins as reorderPinsModel
} from '@/core/fixed/FolderOps';
import {
  computeAddTabsToFolder,
  computeMoveFolder,
  computeMoveFolderItem,
  computeRemoveFolder,
  computeReorderFolderItems,
  computeRenameFolder,
  computeToggleFolderCollapsed,
  fixedItemKey
} from '@/core/commands/folderCommands';
import { reconcileBindings, reconcilePendingItems } from '@/core/fixed/Reconcile';
import {
  DEFAULT_SETTINGS,
  FixedFolderSchema,
  PersistentPinSchema,
  SettingsSchema,
  parseExportFile,
  type ExportFile,
  type FixedFolder,
  type PersistentPin,
  type Settings,
  type SiteCollapseState,
  type Snapshot
} from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { structuralSignature } from '@/core/util/signature';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { getRepositories } from '@/platform/storage/repositories';
import { syncMirror } from '@/platform/storage/SyncMirror';
import { readBookmarkBar } from '@/platform/bookmarks';
import { SettingsSyncedMessageSchema } from '@/platform/messages';
import { readSession, mutateSession, type MutateSessionResult } from '@/platform/storage/session';
import { logDegraded, logFailure } from '@/platform/diagnostics';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import {
  activateTab as activateTabPlatform,
  createNewTab as createNewTabPlatform,
  groupTabs,
  queryCurrentWindowTabs,
  togglePinned as togglePinnedPlatform,
  updateGroupMeta,
  updateTabUrl
} from '@/platform/tabs';

/**
 * 固定空间数据 store：文件夹、永久固定图标、设置、折叠状态。
 * 持久化经 DataRepository（chrome.storage.local + zod + 坏数据隔离）。
 */

/** 拖标签/分组进入收藏夹的落位结果计数。对外导出供 UI 层组织反馈文案。 */
export interface AddTabsToFolderResult {
  added: number;
  moved: number;
  skipped: number;
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
  reorderFolderItems: (
    folderId: string,
    sourceId: string,
    targetId: string,
    placeAfter: boolean
  ) => Promise<void>;
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
  /** 恢复全部设置为默认值。 */
  resetSettings: () => Promise<void>;
  /** 清除所有本地数据（不可恢复）：仓库 + 会话存储 + 跨设备镜像，内存态重置为默认。 */
  clearAllData: () => Promise<void>;
  /** 重新从存储读取设置并应用到 store（跨页面同步兜底）。 */
  refreshSettings: () => Promise<void>;
  /** 导出完整备份（固定空间 + 设置 + 全部快照族），不包含当前打开标签或撤销栈。 */
  exportData: () => ExportFile;
  /** 校验并覆盖导入备份（事务），不触碰当前打开标签；快照由 snapshotStore 接管。 */
  importData: (raw: unknown) => Promise<void>;
  /** 从书签栏导入固定文件夹（同名合并，URL 全局去重）。 */
  importBookmarksFromBar: () => Promise<{ foldersCreated: number; itemsImported: number }>;

  /** 快照联动：挂起转正 + 绑定维护（由 tabStore 每次刷新后调用）。 */
  reconcileWithTabs: (tabs: readonly TabRecord[]) => Promise<void>;
}

/**
 * 高频写合并器：同一写入批次（上一次写完成前到达的调用）只落盘最终值，
 * 消除拖拽重排等连续操作时的 chrome.storage 全量写入放大。
 * 语义：调用方 await 的 Promise 在“本批最终值已落盘”后 resolve。
 * 注意：DataRepository.write 内部已捕获错误并返回成败标志，此合并器不改变该语义。
 */
function createCoalescedWriter<T, R>(repo: { write: (value: T) => Promise<R> }) {
  let inflight: Promise<R> | null = null;
  let queued: T | undefined;
  let hasQueued = false;

  /**
   * 返回本批次最后一次真实落盘的结果：
   * 合并掉的中间值不再单独落盘，因此它们的成败对用户不可见也无意义；
   * 调用方关心的始终是「最终值是否保存成功」，故返回末次 write 的返回值。
   */
  return (value: T): Promise<R> => {
    queued = value;
    hasQueued = true;
    if (inflight) return inflight;
    inflight = (async () => {
      let last!: R;
      while (hasQueued) {
        hasQueued = false;
        const target = queued as T;
        last = await repo.write(target);
      }
      return last;
    })();
    void inflight.finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

/** 页面实例级初始化守卫：StrictMode 双执行 / 多入口重复调用只初始化一次。 */
let initialized = false;

/**
 * 快照读取桥（避免 dataStore → snapshotStore 直接依赖造成的模块环）。
 * 由 snapshotStore 在初始化时登记；未登记（如设置页未加载快照）时导出快照为空数组。
 */
let snapshotProvider: (() => readonly Snapshot[]) | undefined;

/** 登记快照读取器（snapshotStore 初始化时调用）。 */
export function registerSnapshotProvider(provider: () => readonly Snapshot[]): void {
  snapshotProvider = provider;
}

/** 撤销登记（测试隔离用）。 */
export function resetSnapshotProvider(): void {
  snapshotProvider = undefined;
}

export const useDataStore = create<DataState>()((set, get) => {
  // 依赖访问器：经组合根取用，便于测试注入（见 registry.ts）。
  const repos = getRepositories();

  // 写入工具：闭包内定义，用 set/get 访问 store，避免模块级声明顺序依赖（no-use-before-define）。
  // 写合并保留 DataRepository.write 的 boolean 语义，便于写失败时上报降级。
  const writeFoldersCoalesced = createCoalescedWriter<FixedFolder[], boolean>(repos.folders);
  const writePinsCoalesced = createCoalescedWriter<PersistentPin[], boolean>(repos.pins);

  /** 把最新本地数据镜像到浏览器同步通道（写合并 + 配额降级）。 */
  const scheduleMirror = (state: {
    folders: FixedFolder[];
    pins: PersistentPin[];
    settings: Settings;
  }): void => {
    syncMirror.schedule({ folders: state.folders, pins: state.pins, settings: state.settings });
  };

  /**
   * 持久化失败统一上报：置起 storageDegraded 供 UI 提示，并写入诊断日志。
   * 禁止在写入失败后继续展示成功——「界面显示成功但重启即丢失」是信任事故。
   */
  function reportPersistenceFailure(scope: string, message: string): void {
    if (!get().storageDegraded) set({ storageDegraded: true });
    logDegraded(scope, message);
  }

  async function writeFolders(folders: FixedFolder[]): Promise<void> {
    // 先更新内存态（UI 即时响应），storage 落盘合并为最终值。
    set({ folders });
    const ok = await writeFoldersCoalesced(folders);
    // 落盘失败不回滚内存态（重排/新增等高频操作回滚会造成界面跳动），
    // 但必须置起降级标志，让 UI 明确告知「可能未保存」而不是假装成功。
    if (ok === false)
      reportPersistenceFailure('dataStore', '固定文件夹写入失败，重启后可能丢失本次改动');
    scheduleMirror(get());
  }

  /** 应用会话变更结果并同步绑定集合。persisted 为 false 时置起 storageDegraded 供 UI 提示。 */
  function applyBindings(result: MutateSessionResult): void {
    set({ boundTabIds: Object.values(result.data.itemTabBindings) });
    if (!result.persisted && !get().storageDegraded) {
      set({ storageDegraded: true });
      logDegraded('dataStore', '会话绑定未能持久化，面板重启后挂起条目绑定将丢失');
    }
  }

  async function writePins(pins: PersistentPin[]): Promise<void> {
    set({ pins });
    const ok = await writePinsCoalesced(pins);
    if (ok === false)
      reportPersistenceFailure('dataStore', '固定图标写入失败，重启后可能丢失本次改动');
    scheduleMirror(get());
  }

  // 跨页面设置同步：设置页 / 侧边栏 / popup 各自持有独立 dataStore 实例，
  // 通过 storage.onChanged 感知其他页面写入的设置并实时应用（否则改完设置需重开面板才生效）。
  // 另提供 refreshSettings（重新读存储）与 settings-synced 广播消息作为双保险。
  const syncSettingsFromStorage = async (): Promise<void> => {
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
    const message = SettingsSyncedMessageSchema.parse({ type: 'settings-synced' });
    browser.runtime.sendMessage(message).catch(() => {});
  };
  let settingsWatcherStarted = false;
  const startSettingsWatcher = (): void => {
    if (settingsWatcherStarted) return;
    settingsWatcherStarted = true;
    repos.settings.watch(() => void syncSettingsFromStorage());
  };

  return {
    folders: [],
    pins: [],
    collapsedSites: [],
    settings: DEFAULT_SETTINGS,
    boundTabIds: [],
    storageDegraded: false,
    ready: false,

    initialize: async () => {
      if (initialized) return;
      initialized = true;
      startSettingsWatcher();
      try {
        const [folders, pins, collapsedSites, settings, session, seeded] = await Promise.all([
          repos.folders.read(),
          repos.pins.read(),
          repos.collapse.read(),
          repos.settings.read(),
          readSession(),
          repos.seeded.read()
        ]);
        let effectiveFolders = folders;
        let effectivePins = pins;
        let effectiveSettings = settings;
        if (!seeded) {
          // 新设备首次启动：从浏览器同步通道镜像恢复（本地有数据时以本地为准）
          const mirror = await syncMirror.pull();
          if (mirror) {
            const parsedFolders = FixedFolderSchema.array().safeParse(mirror.folders);
            const parsedPins = PersistentPinSchema.array().safeParse(mirror.pins);
            const parsedSettings = SettingsSchema.safeParse(mirror.settings);
            if (parsedFolders.success && folders.length === 0)
              effectiveFolders = parsedFolders.data;
            if (parsedPins.success && pins.length === 0) effectivePins = parsedPins.data;
            if (parsedSettings.success) effectiveSettings = parsedSettings.data;
          }
          await repos.seeded.write(true);
          // 镜像恢复写入失败不阻断启动（本地数据仍在），但必须留痕，否则「新设备没恢复出来」无从排查。
          if (effectiveFolders !== folders) {
            const ok = await repos.folders.write(effectiveFolders);
            if (!ok) reportPersistenceFailure('dataStore', '镜像恢复的固定文件夹写入失败');
          }
          if (effectivePins !== pins) {
            const ok = await repos.pins.write(effectivePins);
            if (!ok) reportPersistenceFailure('dataStore', '镜像恢复的固定图标写入失败');
          }
          if (effectiveSettings !== settings) {
            const ok = await repos.settings.write(effectiveSettings);
            if (!ok) reportPersistenceFailure('dataStore', '镜像恢复的设置写入失败');
          }
        }
        set({
          folders: effectiveFolders,
          pins: dedupePins(effectivePins),
          collapsedSites,
          settings: effectiveSettings,
          boundTabIds: Object.values(session.itemTabBindings),
          ready: true
        });
        // 数据加载后立即同步主题镜像，确保防闪烁初始化与最新设置一致（单一数据源）。
        applyTheme(effectiveSettings.themePreference, effectiveSettings.colorTheme);
        // 回显守卫：本页面自身写入触发的 watch 回放内容相同，直接跳过，避免双倍渲染。
        repos.folders.watch((value) => {
          if (structuralSignature(value) === structuralSignature(get().folders)) return;
          set({ folders: value });
        });
        repos.pins.watch((value) => {
          const next = dedupePins(value);
          if (structuralSignature(next) === structuralSignature(get().pins)) return;
          set({ pins: next });
        });
        repos.collapse.watch((value) => {
          if (structuralSignature(value) === structuralSignature(get().collapsedSites)) return;
          set({ collapsedSites: value });
        });
        // 设置变更由 startSettingsWatcher 统一处理（重读 + 主题应用），不再重复 watch。
      } catch (error) {
        // 初始化失败：回滚守卫以允许重试（否则面板永久停在 Loading 骨架屏）。
        initialized = false;
        set({ ready: false });
        throw error;
      }
    },

    createFolder: async (name) => {
      const folder = createFolderModel(name);
      await writeFolders([...get().folders, folder]);
      return folder;
    },

    renameFolder: async (folderId, name) => {
      await writeFolders(computeRenameFolder(get().folders, folderId, name));
    },

    deleteFolder: async (folderId) => {
      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        for (const item of get().folders.find((f) => f.id === folderId)?.items ?? []) {
          delete bindings[item.id];
        }
        return { itemTabBindings: bindings };
      });
      await writeFolders(computeRemoveFolder(get().folders, folderId));
      applyBindings(result);
    },

    toggleFolderCollapsed: async (folderId) => {
      await writeFolders(computeToggleFolderCollapsed(get().folders, folderId));
    },

    addTabsToFolder: async (tabs, folderId) => {
      const currentFolders = get().folders;
      const candidates = new Map<string, { url: string; title: string; favIconUrl?: string }>();
      for (const tab of tabs) {
        const key = webComparisonKey(tab.url, tab.pendingUrl);
        if (!key) continue;
        candidates.set(key, {
          url: key,
          title: tab.title || key,
          favIconUrl: tab.favIconUrl
        });
      }
      const folderExists = currentFolders.some((folder) => folder.id === folderId);
      if (candidates.size === 0 || !folderExists) {
        return { added: 0, moved: 0, skipped: tabs.length };
      }

      // 纯计算：下一版 folders + 绑定所需中间量（与平台无关，可单测）。
      const computed = computeAddTabsToFolder(currentFolders, candidates, folderId);

      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        const boundTabIds = new Set(Object.values(bindings));
        for (const folder of currentFolders) {
          for (const item of folder.items) {
            const key = fixedItemKey(item.url);
            const selected = computed.selectedExisting.get(key);
            if (
              computed.duplicateItemIds.has(item.id) ||
              (computed.comparisonKeys.has(key) && selected?.id !== item.id)
            ) {
              const boundId = bindings[item.id];
              delete bindings[item.id];
              if (boundId !== undefined) boundTabIds.delete(boundId);
            }
          }
        }
        // 为新条目建立绑定：按 URL 匹配传入标签，未占用、未固定、非隐身的才绑定，
        // 让刚拖入的标签立即从临时区排除（否则要等 reconcileWithTabs 才补绑）。
        for (const newItem of computed.newItems) {
          const key = fixedItemKey(newItem.url);
          const tab = tabs.find((candidate) => {
            return (
              webComparisonKey(candidate.url, candidate.pendingUrl) === key &&
              !candidate.pinned &&
              !candidate.incognito &&
              !boundTabIds.has(candidate.id)
            );
          });
          if (tab) {
            bindings[newItem.id] = tab.id;
            boundTabIds.add(tab.id);
          }
        }
        return { itemTabBindings: bindings };
      });
      await writeFolders(computed.next);
      applyBindings(result);
      return {
        added: computed.newItems.length,
        moved: computed.moved,
        skipped: tabs.length - candidates.size + computed.targetDuplicates
      };
    },

    removeFolderItem: async (folderId, itemId) => {
      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        delete bindings[itemId];
        return { itemTabBindings: bindings };
      });
      // 同步绑定标签 id，让被释放的标签立即回到临时区。
      applyBindings(result);

      await writeFolders(
        get().folders.map((folder) =>
          folder.id === folderId
            ? { ...folder, items: folder.items.filter((item) => item.id !== itemId) }
            : folder
        )
      );
    },

    reorderFolderItems: async (folderId, sourceId, targetId, placeAfter) => {
      await writeFolders(
        computeReorderFolderItems(get().folders, { folderId, sourceId, targetId, placeAfter })
      );
    },

    moveFolder: async (sourceId, targetId, placeAfter) => {
      await writeFolders(computeMoveFolder(get().folders, { sourceId, targetId, placeAfter }));
    },

    moveFolderItem: async (sourceFolderId, itemId, targetFolderId) => {
      await writeFolders(
        computeMoveFolderItem(get().folders, { sourceFolderId, itemId, targetFolderId })
      );
    },

    openSavedItem: async (item) => {
      const tabs = await queryCurrentWindowTabs();
      const { itemTabBindings: bindings } = await readSession();
      const windowId = tabs[0]?.windowId;

      // 0) 挂起条目优先：激活其待导航标签（url 尚未转正时避免误匹配/重复新建）
      if (item.pendingTabId !== undefined) {
        const pendingTab = tabs.find((tab) => tab.id === item.pendingTabId);
        if (pendingTab) {
          await activateTabPlatform(pendingTab.id);
          return;
        }
      }

      // 1) 绑定标签优先
      const boundTabId = bindings[item.id];
      if (boundTabId !== undefined && tabs.some((tab) => tab.id === boundTabId)) {
        await activateTabPlatform(boundTabId);
        return;
      }
      // 2) 窗口内精确 URL 匹配
      const exact = tabs.find((tab) => tab.url === item.url && !tab.incognito);
      if (exact) {
        const result = await mutateSession((session) => ({
          itemTabBindings: { ...session.itemTabBindings, [item.id]: exact.id }
        }));
        applyBindings(result);
        await activateTabPlatform(exact.id);
        return;
      }
      // 3) 新建并绑定
      if (windowId === undefined) return;
      const created = await createNewTabPlatform(windowId);
      // 豁免复用：显式打开的固定项不允许被自动合并（与 RestoreEngine 一致）。
      // 须在导航前发放（onUpdated 先到时令牌未就位会被合并），创建失败则不发放（避免令牌残留误豁免）。
      if (item.url) {
        await grantReuseAllowance(windowId, item.url);
        await updateTabUrl(created.id, item.url);
      }
      const result = await mutateSession((session) => ({
        itemTabBindings: { ...session.itemTabBindings, [item.id]: created.id }
      }));
      applyBindings(result);
    },

    createFolderFromNativeGroup: async (name, groupTabs) => {
      const savable = new Map<string, { url: string; title: string; favIconUrl?: string }>();
      for (const tab of groupTabs) {
        const key = webComparisonKey(tab.url, tab.pendingUrl);
        if (key) {
          savable.set(key, {
            url: key,
            title: tab.title || key,
            favIconUrl: tab.favIconUrl
          });
        }
      }
      const folder = createFolderModel(name);
      const items = [...savable.values()].map((entry) => createFolderItem(entry));
      await writeFolders([...get().folders, { ...folder, items }]);

      // 建立绑定：精确 URL 匹配（串行化内完成，防并发覆盖）
      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        const boundTabIds = new Set(Object.values(bindings));
        for (const item of items) {
          const match = groupTabs.find(
            (tab) => tab.url === item.url && !tab.pinned && !boundTabIds.has(tab.id)
          );
          if (match) {
            bindings[item.id] = match.id;
            boundTabIds.add(match.id);
          }
        }
        return { itemTabBindings: bindings };
      });
      applyBindings(result);
    },

    syncFolderToNativeGroup: async (folderId) => {
      const folder = get().folders.find((f) => f.id === folderId);
      if (!folder) return false;

      const items = folder.items.filter((item) => item.url);
      if (items.length === 0) return false;

      // 先恢复已关闭的固定条目，确保转换不是“只处理当前碰巧打开的标签”。
      // 窗口内标签集合在一次查询内复用（openSavedItem 新建的标签由末尾补查感知）。
      const initialTabs = await queryCurrentWindowTabs();
      for (const item of items) {
        const alreadyOpen = initialTabs.some(
          (tab) => tab.url === item.url && !tab.incognito && !tab.pinned
        );
        if (!alreadyOpen) await get().openSavedItem(item);
      }

      const tabs = await queryCurrentWindowTabs();
      const memberIds: number[] = [];
      const seen = new Set<number>();
      for (const item of items) {
        const tab = tabs.find(
          (candidate) =>
            candidate.url === item.url &&
            !candidate.incognito &&
            !candidate.pinned &&
            !seen.has(candidate.id)
        );
        if (tab) {
          memberIds.push(tab.id);
          seen.add(tab.id);
        }
      }
      if (memberIds.length === 0) return false;

      const groupId = await groupTabs(memberIds);
      if (groupId === undefined) return false;
      await updateGroupMeta(groupId, folder.name);
      await get().deleteFolder(folderId);
      return true;
    },

    addPin: async (tab) => {
      if (!tab.url) return;
      const pin = pinFromTab({ url: tab.url, title: tab.title || '', favIconUrl: tab.favIconUrl });
      if (!pin) return;
      const next = dedupePins([...get().pins.filter((p) => p.identity !== pin.identity), pin]);
      await writePins(next);
      // 同步把真实标签置为 Chrome 固定。
      // togglePinned 为翻转语义：传入「当前未固定 false」→ 翻转为固定。
      if (!tab.pinned) await togglePinnedPlatform(tab.id, false);
    },

    removePin: async (pin) => {
      await writePins(get().pins.filter((p) => p.id !== pin.id));
      // 取消窗口内同身份标签的 Chrome 固定
      const tabs = await queryCurrentWindowTabs();
      for (const tab of tabs) {
        if (tab.pinned && tab.url && pinIdentity(tab.url) === pin.identity) {
          // togglePinned 为翻转语义：传入「当前已固定 true」→ 翻转为取消固定。
          await togglePinnedPlatform(tab.id, true);
        }
      }
    },

    reorderPins: async (sourceId, targetId, placeAfter) => {
      const next = reorderPinsModel(get().pins, { sourceId, targetId, placeAfter });
      if (next === get().pins) return;
      await writePins(next);
    },

    openPin: async (pin) => {
      const tabs = await queryCurrentWindowTabs();
      const windowId = tabs[0]?.windowId;
      const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
      const ranked = [...matches].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.id - b.id;
      });
      if (ranked[0]) {
        await activateTabPlatform(ranked[0].id);
        // togglePinned 为翻转语义：传入「当前未固定 false」→ 翻转为固定。
        if (!ranked[0].pinned) await togglePinnedPlatform(ranked[0].id, false);
        return;
      }
      if (windowId === undefined) return;
      const created = await createNewTabPlatform(windowId);
      // 豁免复用：显式打开的固定图标不允许被自动合并；须在导航前发放（同 openSavedItem）。
      await grantReuseAllowance(windowId, pin.url);
      await updateTabUrl(created.id, pin.url);
      // togglePinned 为翻转语义：传入「当前未固定 false」→ 翻转为固定。
      await togglePinnedPlatform(created.id, false);
    },

    toggleSiteCollapsed: async (siteKey, collapsed) => {
      const next = collapsed
        ? get().collapsedSites.includes(siteKey)
          ? get().collapsedSites
          : [...get().collapsedSites, siteKey]
        : get().collapsedSites.filter((key) => key !== siteKey);
      const ok = await repos.collapse.write(next);
      if (!ok) reportPersistenceFailure('dataStore', '站点折叠状态写入失败（仅影响分组展开状态）');
      set({ collapsedSites: next });
    },

    updateSettings: async (partial) => {
      const parsed = SettingsSchema.safeParse({ ...get().settings, ...partial });
      if (!parsed.success) throw new Error('invalid-settings');
      const ok = await repos.settings.write(parsed.data);
      // 设置是跨会话行为契约：落盘失败时必须报错，不能让界面停留在未保存的新值上。
      if (!ok) {
        reportPersistenceFailure('dataStore', '设置写入失败，本次修改未保存');
        throw new Error('settings-write-failed');
      }
      set({ settings: parsed.data });
      scheduleMirror(get());
      broadcastSettingsSynced();
    },

    resetSettings: async () => {
      const ok = await repos.settings.write(DEFAULT_SETTINGS);
      if (!ok) {
        reportPersistenceFailure('dataStore', '恢复默认设置失败，设置未变更');
        throw new Error('settings-write-failed');
      }
      set({ settings: DEFAULT_SETTINGS });
      applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
      scheduleMirror(get());
      broadcastSettingsSynced();
    },

    /**
     * 清除所有本地数据（不可恢复）：本地仓库 + 会话存储 + 跨设备镜像，内存态重置为默认。
     *
     * 顺序有讲究：先清 sync 镜像再清 local —— 否则下次初始化（seeded 标志随 local
     * 清空）会从旧镜像把数据「复活」。撤销栈的持久化随 local.clear 一并清空；
     * 内存栈由调用方（UI 层）经 undoStore.clearBatches 同步清空。
     */
    clearAllData: async () => {
      await syncMirror.clearAll();
      await browser.storage.local.clear();
      await browser.storage.session.clear();
      set({
        folders: [],
        pins: [],
        collapsedSites: [],
        settings: DEFAULT_SETTINGS,
        boundTabIds: [],
        ready: true
      });
      applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
      // 把「空态」镜像回 sync（去抖落盘），保持 local/sync 终态一致。
      scheduleMirror(get());
      broadcastSettingsSynced();
    },

    refreshSettings: () => syncSettingsFromStorage(),

    /**
     * 导出为完整备份：固定空间 + 设置 + 全部快照族。
     * 快照经仓库最新值读取：面板打开期间 background 可能写入关窗自动快照。
     */
    exportData: () => ({
      format: 'tabs.export' as const,
      exportedAt: new Date().toISOString(),
      fixedFolders: get().folders,
      persistentPins: get().pins,
      siteCollapse: get().collapsedSites,
      settings: get().settings,
      snapshots: [...(snapshotProvider?.() ?? [])]
    }),

    /**
     * 导入为事务：五个分区（文件夹 / 固定图标 / 折叠态 / 设置 / 快照族）全部落盘成功后才切换内存态。
     *
     * 早期实现用 Promise.all 并发写且只看是否 reject——DataRepository.write 以 boolean
     * 表达失败，于是「部分分区写成功」也会整体提示导入成功，用户以为已完成备份迁移。
     * 现改为串行写 + 失败回滚：任一分区写失败即把已写入的分区还原为导入前的值。
     */
    importData: async (raw) => {
      const parsed = parseExportFile(raw);
      if (!parsed.success) throw new Error('invalid-tab-haven-export');
      const data = parsed.data;

      const before = {
        folders: get().folders,
        pins: get().pins,
        collapse: get().collapsedSites,
        settings: get().settings,
        snapshots: [...(snapshotProvider?.() ?? [])]
      };

      const steps: { name: string; write: () => Promise<boolean>; rollback: () => Promise<boolean> }[] =
        [
          {
            name: 'folders',
            write: () => repos.folders.write(data.fixedFolders),
            rollback: () => repos.folders.write(before.folders)
          },
          {
            name: 'pins',
            write: () => repos.pins.write(data.persistentPins),
            rollback: () => repos.pins.write(before.pins)
          },
          {
            name: 'siteCollapse',
            write: () => repos.collapse.write(data.siteCollapse),
            rollback: () => repos.collapse.write(before.collapse)
          },
          {
            name: 'settings',
            write: () => repos.settings.write(data.settings),
            rollback: () => repos.settings.write(before.settings)
          },
          // 快照可能体积较大，放在最后：前面任一分区失败时不必先写再回滚大数据块。
          {
            name: 'snapshots',
            write: () => repos.snapshots.write(data.snapshots),
            rollback: () => repos.snapshots.write(before.snapshots)
          }
        ];

      const done: (typeof steps)[number][] = [];
      for (const step of steps) {
        const ok = await step.write();
        if (ok) {
          done.push(step);
          continue;
        }
        // 回滚已写入的分区；回滚本身失败仅告警（尽力而为），但必须在错误信息中如实告知。
        const rollbackFailures: string[] = [];
        for (const written of done) {
          const restored = await written.rollback();
          if (!restored) rollbackFailures.push(written.name);
        }
        const message = `导入失败：分区 ${step.name} 写入未成功，已回滚${rollbackFailures.length > 0 ? `；回滚未完成的分区：${rollbackFailures.join(', ')}` : ''}`;
        logFailure('dataStore', message);
        throw new Error(`import-write-failed:${step.name}`);
      }

      set({
        folders: data.fixedFolders,
        pins: data.persistentPins,
        collapsedSites: data.siteCollapse,
        settings: data.settings
      });
      // 快照属于 snapshotStore 的内存态：本 store 不持有，交由其自行感知仓库变更
      // （snapshotStore.load 已 watch 仓库，写入后会自动同步列表与角标）。
      applyTheme(data.settings.themePreference, data.settings.colorTheme);
      scheduleMirror(get());
      broadcastSettingsSynced();
    },

    importBookmarksFromBar: async () => {
      const bar = await readBookmarkBar();
      const { folders } = get();
      const seen = new Set<string>();
      for (const folder of folders) {
        for (const item of folder.items) {
          seen.add(webComparisonKey(item.url ?? '', undefined) ?? item.url ?? '');
        }
      }
      const uniqueLeaves = (
        leaves: { url: string; title: string }[]
      ): { url: string; title: string }[] => {
        const next: { url: string; title: string }[] = [];
        for (const leaf of leaves) {
          const key = webComparisonKey(leaf.url, undefined) ?? leaf.url;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(leaf);
        }
        return next;
      };
      let foldersCreated = 0;
      let itemsImported = 0;
      let next = folders;
      for (const spec of bar.folders) {
        const leaves = uniqueLeaves(spec.leaves);
        if (leaves.length === 0) continue;
        const items = leaves.map((leaf) => createFolderItem({ url: leaf.url, title: leaf.title }));
        const existing = next.find((folder) => folder.name === spec.name);
        if (existing) {
          next = next.map((folder) =>
            folder.id === existing.id ? { ...folder, items: [...folder.items, ...items] } : folder
          );
        } else {
          next = [...next, { ...createFolderModel(spec.name), items }];
          foldersCreated += 1;
        }
        itemsImported += items.length;
      }
      if (bar.looseLeaves.length > 0) {
        const leaves = uniqueLeaves(bar.looseLeaves);
        if (leaves.length > 0) {
          const name = i18n.t('fixed.bookmarksImportName');
          const items = leaves.map((leaf) =>
            createFolderItem({ url: leaf.url, title: leaf.title })
          );
          const existing = next.find((folder) => folder.name === name);
          if (existing) {
            next = next.map((folder) =>
              folder.id === existing.id ? { ...folder, items: [...folder.items, ...items] } : folder
            );
          } else {
            next = [...next, { ...createFolderModel(name), items }];
            foldersCreated += 1;
          }
          itemsImported += items.length;
        }
      }
      if (next !== folders) await writeFolders(next);
      return { foldersCreated, itemsImported };
    },

    reconcileWithTabs: async (tabs) => {
      // 挂起条目转正
      const pending = reconcilePendingItems(get().folders, tabs);
      if (pending.changed) {
        await writeFolders(pending.folders);
      }

      // 绑定维护（串行化内 read-modify-write，防与用户操作竞态）
      const result = await mutateSession((session) => {
        const bindingResult = reconcileBindings(pending.folders, tabs, session.itemTabBindings);
        if (!bindingResult.changed) return {};
        return { itemTabBindings: bindingResult.bindings };
      });
      const nextBoundTabIds = Object.values(result.data.itemTabBindings);
      // 仅当绑定集合实际变化时才更新 store，避免每次标签事件（如仅标题更新）都触发全量重渲染。
      if (structuralSignature(nextBoundTabIds) !== structuralSignature(get().boundTabIds)) {
        set({ boundTabIds: nextBoundTabIds });
      }
      // reconcileWithTabs 是每次标签事件都会走的高频路径，此处只记录降级状态，
      // 不做 set 之外的副作用，避免高频路径放大开销。
      if (!result.persisted && !get().storageDegraded) {
        set({ storageDegraded: true });
        logDegraded('dataStore', '会话绑定未能持久化，面板重启后挂起条目绑定将丢失');
      }
    }
  };
});
