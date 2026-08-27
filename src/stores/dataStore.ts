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
  ExportFileSchema,
  FixedFolderSchema,
  PersistentPinSchema,
  SettingsSchema,
  type ExportFile,
  type FixedFolder,
  type PersistentPin,
  type Settings,
  type SiteCollapseState
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
import { logDegraded } from '@/platform/diagnostics';
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
  /** 重新从存储读取设置并应用到 store（跨页面同步兜底）。 */
  refreshSettings: () => Promise<void>;
  /** 导出固定空间与设置，不包含当前打开标签或撤销栈。 */
  exportData: () => ExportFile;
  /** 校验并覆盖导入固定空间与设置，不触碰当前打开标签。 */
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
function createCoalescedWriter<T>(repo: { write: (value: T) => Promise<unknown> }) {
  let inflight: Promise<void> | null = null;
  let queued: T | undefined;
  let hasQueued = false;

  return (value: T): Promise<void> => {
    queued = value;
    hasQueued = true;
    if (inflight) return inflight;
    inflight = (async () => {
      while (hasQueued) {
        hasQueued = false;
        const target = queued as T;
        await repo.write(target);
      }
    })();
    void inflight.finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

/** 页面实例级初始化守卫：StrictMode 双执行 / 多入口重复调用只初始化一次。 */
let initialized = false;

export const useDataStore = create<DataState>()((set, get) => {
  // 依赖访问器：经组合根取用，便于测试注入（见 registry.ts）。
  const repos = getRepositories();

  // 写入工具：闭包内定义，用 set/get 访问 store，避免模块级声明顺序依赖（no-use-before-define）。
  const writeFoldersCoalesced = createCoalescedWriter<FixedFolder[]>(repos.folders);
  const writePinsCoalesced = createCoalescedWriter<PersistentPin[]>(repos.pins);

  /** 把最新本地数据镜像到浏览器同步通道（写合并 + 配额降级）。 */
  const scheduleMirror = (state: {
    folders: FixedFolder[];
    pins: PersistentPin[];
    settings: Settings;
  }): void => {
    syncMirror.schedule({ folders: state.folders, pins: state.pins, settings: state.settings });
  };

  async function writeFolders(folders: FixedFolder[]): Promise<void> {
    // 先更新内存态（UI 即时响应），storage 落盘合并为最终值。
    set({ folders });
    await writeFoldersCoalesced(folders);
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
    await writePinsCoalesced(pins);
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
          if (effectiveFolders !== folders) await repos.folders.write(effectiveFolders);
          if (effectivePins !== pins) await repos.pins.write(effectivePins);
          if (effectiveSettings !== settings) await repos.settings.write(effectiveSettings);
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
      await repos.collapse.write(next);
      set({ collapsedSites: next });
    },

    updateSettings: async (partial) => {
      const parsed = SettingsSchema.safeParse({ ...get().settings, ...partial });
      if (!parsed.success) throw new Error('invalid-settings');
      await repos.settings.write(parsed.data);
      set({ settings: parsed.data });
      scheduleMirror(get());
      broadcastSettingsSynced();
    },

    resetSettings: async () => {
      await repos.settings.write(DEFAULT_SETTINGS);
      set({ settings: DEFAULT_SETTINGS });
      applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
      scheduleMirror(get());
      broadcastSettingsSynced();
    },

    refreshSettings: () => syncSettingsFromStorage(),

    exportData: () =>
      ExportFileSchema.parse({
        format: 'tabhaven.export',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        fixedFolders: get().folders,
        persistentPins: get().pins,
        siteCollapse: get().collapsedSites,
        settings: get().settings
      }),

    importData: async (raw) => {
      const parsed = ExportFileSchema.safeParse(raw);
      if (!parsed.success) throw new Error('invalid-tab-haven-export');
      const data = parsed.data;
      await Promise.all([
        repos.folders.write(data.fixedFolders),
        repos.pins.write(data.persistentPins),
        repos.collapse.write(data.siteCollapse),
        repos.settings.write(data.settings)
      ]);
      set({
        folders: data.fixedFolders,
        pins: data.persistentPins,
        collapsedSites: data.siteCollapse,
        settings: data.settings
      });
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
