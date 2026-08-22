import { create } from 'zustand';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import {
  createFolder as createFolderModel,
  createFolderItem,
  dedupePins,
  pinFromTab,
  removeItemsWithUrl,
  reorderFolderItems as reorderFolderItemsModel,
  reorderFolders
} from '@/core/fixed/FolderOps';
import { reconcileBindings, reconcilePendingItems } from '@/core/fixed/Reconcile';
import type {
  FixedFolder,
  PersistentPin,
  Settings,
  SiteCollapseState
} from '@/core/schema/models';
import {
  DEFAULT_SETTINGS,
  FixedFolderSchema,
  PersistentPinSchema,
  SettingsSchema,
  SiteCollapseSchema
} from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { inspectUrl } from '@/core/url/UrlInspector';
import { DataRepository } from '@/platform/storage/DataRepository';
import { readSession, updateSession } from '@/platform/storage/session';
import {
  activateTab as activateTabPlatform,
  createNewTab as createNewTabPlatform,
  queryCurrentWindowTabs,
  togglePinned as togglePinnedPlatform,
  updateTabUrl
} from '@/platform/tabs';
import { useTabStore } from '@/stores/tabStore';

/**
 * 固定空间数据 store：文件夹、永久固定图标、设置、折叠状态。
 * 持久化经 DataRepository（chrome.storage.local + zod + 坏数据隔离）。
 */

const foldersRepository = new DataRepository<FixedFolder[]>(
  'tabhaven.fixed-folders.v1',
  FixedFolderSchema.array(),
  []
);
const pinsRepository = new DataRepository<PersistentPin[]>(
  'tabhaven.persistent-pins.v1',
  PersistentPinSchema.array(),
  []
);
const collapseRepository = new DataRepository<SiteCollapseState>(
  'tabhaven.site-collapse.v1',
  SiteCollapseSchema,
  []
);
const settingsRepository = new DataRepository<Settings>(
  'tabhaven.settings.v1',
  SettingsSchema,
  DEFAULT_SETTINGS
);

interface DataState {
  folders: FixedFolder[];
  pins: PersistentPin[];
  collapsedSites: SiteCollapseState;
  settings: Settings;
  /** 绑定到固定条目的标签 id（从临时区排除）。 */
  boundTabIds: number[];
  ready: boolean;

  /** 加载全部数据并订阅变更。 */
  initialize: () => Promise<void>;

  createFolder: (name: string) => Promise<FixedFolder>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  toggleFolderCollapsed: (folderId: string) => Promise<void>;
  /** 拖标签入文件夹（URL 全局唯一）。 */
  addTabToFolder: (tab: TabRecord, folderId: string) => Promise<void>;
  /** 组内新建标签（挂起条目）。 */
  createTabInFixedFolder: (folder: FixedFolder) => Promise<void>;
  removeFolderItem: (folderId: string, itemId: string) => Promise<void>;
  reorderFolderItems: (
    folderId: string,
    sourceId: string,
    targetId: string,
    placeAfter: boolean
  ) => Promise<void>;
  /** 文件夹排序。 */
  moveFolder: (sourceId: string, targetId: string, placeAfter: boolean) => Promise<void>;
  /** 打开固定条目（绑定/精确匹配/新建 三级）。 */
  openSavedItem: (item: { id: string; url: string }) => Promise<void>;
  /** 从原生组保存为固定文件夹（去重 + 建立绑定）。 */
  createFolderFromNativeGroup: (name: string, groupTabs: readonly TabRecord[]) => Promise<void>;

  addPin: (tab: TabRecord) => Promise<void>;
  removePin: (pin: PersistentPin) => Promise<void>;
  openPin: (pin: PersistentPin) => Promise<void>;

  toggleSiteCollapsed: (siteKey: string) => Promise<void>;
  updateSettings: (partial: Partial<Settings>) => Promise<void>;

  /** 快照联动：挂起转正 + 绑定维护（由 tabStore 每次刷新后调用）。 */
  reconcileWithTabs: (tabs: readonly TabRecord[]) => Promise<void>;
}

async function writeFolders(folders: FixedFolder[]): Promise<void> {
  await foldersRepository.write(folders);
  useDataStore.setState({ folders });
}

async function writePins(pins: PersistentPin[]): Promise<void> {
  await pinsRepository.write(pins);
  useDataStore.setState({ pins });
}

export const useDataStore = create<DataState>()((set, get) => ({
  folders: [],
  pins: [],
  collapsedSites: [],
  settings: DEFAULT_SETTINGS,
  boundTabIds: [],
  ready: false,

  initialize: async () => {
    const [folders, pins, collapsedSites, settings, session] = await Promise.all([
      foldersRepository.read(),
      pinsRepository.read(),
      collapseRepository.read(),
      settingsRepository.read(),
      readSession()
    ]);
    set({
      folders,
      pins: dedupePins(pins),
      collapsedSites,
      settings,
      boundTabIds: Object.values(session.itemTabBindings),
      ready: true
    });
    foldersRepository.watch((value) => set({ folders: value }));
    pinsRepository.watch((value) => set({ pins: dedupePins(value) }));
    collapseRepository.watch((value) => set({ collapsedSites: value }));
    settingsRepository.watch((value) => set({ settings: value }));
  },

  createFolder: async (name) => {
    const folder = createFolderModel(name);
    await writeFolders([...get().folders, folder]);
    return folder;
  },

  renameFolder: async (folderId, name) => {
    await writeFolders(
      get().folders.map((folder) => (folder.id === folderId ? { ...folder, name } : folder))
    );
  },

  deleteFolder: async (folderId) => {
    const session = await readSession();
    const bindings = { ...session.itemTabBindings };
    for (const item of get().folders.find((f) => f.id === folderId)?.items ?? []) {
      delete bindings[item.id];
    }
    await updateSession({ itemTabBindings: bindings });
    await writeFolders(get().folders.filter((folder) => folder.id !== folderId));
  },

  toggleFolderCollapsed: async (folderId) => {
    await writeFolders(
      get().folders.map((folder) =>
        folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder
      )
    );
  },

  addTabToFolder: async (tab, folderId) => {
    const inspection = inspectUrl(tab.url, tab.pendingUrl);
    if (inspection.category !== 'web' || !inspection.comparisonKey) return;

    // URL 全局唯一：先移除所有文件夹中的同 URL 条目及其绑定
    const foldersWithout = removeItemsWithUrl(get().folders, inspection.comparisonKey);
    const session = await readSession();
    const bindings = { ...session.itemTabBindings };
    for (const folder of get().folders) {
      for (const item of folder.items) {
        if (item.url === inspection.comparisonKey) delete bindings[item.id];
      }
    }

    const item = createFolderItem({
      url: inspection.comparisonKey,
      title: tab.title || inspection.comparisonKey,
      favIconUrl: tab.favIconUrl
    });
    const next = foldersWithout.map((folder) =>
      folder.id === folderId
        ? { ...folder, collapsed: false, items: [...folder.items, item] }
        : folder
    );
    await writeFolders(next);
    await updateSession({ itemTabBindings: bindings });
  },

  createTabInFixedFolder: async (folder) => {
    const windowId = useTabStore.getState().currentWindowId;
    if (windowId === undefined) return;
    const newTab = await createNewTabPlatform(windowId);
    const item = createFolderItem({
      url: '',
      title: '新标签页',
      pendingTabId: newTab.id
    });
    const next = get().folders.map((f) =>
      f.id === folder.id ? { ...f, collapsed: false, items: [...f.items, item] } : f
    );
    await writeFolders(next);
  },

  removeFolderItem: async (folderId, itemId) => {
    const session = await readSession();
    const bindings = { ...session.itemTabBindings };
    delete bindings[itemId];
    await updateSession({ itemTabBindings: bindings });

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
      get().folders.map((folder) =>
        folder.id === folderId
          ? reorderFolderItemsModel(folder, sourceId, targetId, placeAfter)
          : folder
      )
    );
  },

  moveFolder: async (sourceId, targetId, placeAfter) => {
    await writeFolders(reorderFolders(get().folders, sourceId, targetId, placeAfter));
  },

  openSavedItem: async (item) => {
    const tabs = await queryCurrentWindowTabs();
    const session = await readSession();
    const bindings = { ...session.itemTabBindings };
    const windowId = tabs[0]?.windowId;

    // 1) 绑定标签优先
    const boundTabId = bindings[item.id];
    if (boundTabId !== undefined && tabs.some((tab) => tab.id === boundTabId)) {
      await activateTabPlatform(boundTabId);
      return;
    }
    // 2) 窗口内精确 URL 匹配
    const exact = tabs.find((tab) => tab.url === item.url && !tab.incognito);
    if (exact) {
      bindings[item.id] = exact.id;
      await updateSession({ itemTabBindings: bindings });
      await activateTabPlatform(exact.id);
      return;
    }
    // 3) 新建并绑定
    if (windowId === undefined) return;
    const created = await createNewTabPlatform(windowId);
    if (item.url) await updateTabUrl(created.id, item.url);
    bindings[item.id] = created.id;
    await updateSession({ itemTabBindings: bindings });
  },

  createFolderFromNativeGroup: async (name, groupTabs) => {
    const savable = new Map<string, { url: string; title: string; favIconUrl?: string }>();
    for (const tab of groupTabs) {
      const inspection = inspectUrl(tab.url, tab.pendingUrl);
      if (inspection.category === 'web' && inspection.comparisonKey) {
        savable.set(inspection.comparisonKey, {
          url: inspection.comparisonKey,
          title: tab.title || inspection.comparisonKey,
          favIconUrl: tab.favIconUrl
        });
      }
    }
    const folder = createFolderModel(name);
    const items = [...savable.values()].map((entry) => createFolderItem(entry));
    await writeFolders([...get().folders, { ...folder, items }]);

    // 建立绑定：精确 URL 匹配
    const session = await readSession();
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
    await updateSession({ itemTabBindings: bindings });
  },

  addPin: async (tab) => {
    if (!tab.url) return;
    const pin = pinFromTab({ url: tab.url, title: tab.title || '', favIconUrl: tab.favIconUrl });
    if (!pin) return;
    const next = dedupePins([...get().pins.filter((p) => p.identity !== pin.identity), pin]);
    await writePins(next);
    // 同步把真实标签置为 Chrome 固定（行为规格 C-2）
    if (!tab.pinned) await togglePinnedPlatform(tab.id, true);
  },

  removePin: async (pin) => {
    await writePins(get().pins.filter((p) => p.id !== pin.id));
    // 取消窗口内同身份标签的 Chrome 固定
    const tabs = await queryCurrentWindowTabs();
    for (const tab of tabs) {
      if (tab.pinned && tab.url && pinIdentity(tab.url) === pin.identity) {
        await togglePinnedPlatform(tab.id, false);
      }
    }
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
      if (!ranked[0].pinned) await togglePinnedPlatform(ranked[0].id, true);
      return;
    }
    if (windowId === undefined) return;
    const created = await createNewTabPlatform(windowId);
    await updateTabUrl(created.id, pin.url);
    await togglePinnedPlatform(created.id, true);
  },

  toggleSiteCollapsed: async (siteKey) => {
    const next = get().collapsedSites.includes(siteKey)
      ? get().collapsedSites.filter((key) => key !== siteKey)
      : [...get().collapsedSites, siteKey];
    await collapseRepository.write(next);
    set({ collapsedSites: next });
  },

  updateSettings: async (partial) => {
    const next = { ...get().settings, ...partial };
    await settingsRepository.write(next);
    set({ settings: next });
  },

  reconcileWithTabs: async (tabs) => {
    const session = await readSession();

    // 挂起条目转正
    const pending = reconcilePendingItems(get().folders, tabs);
    if (pending.changed) {
      await writeFolders(pending.folders);
    }

    // 绑定维护
    const bindingResult = reconcileBindings(pending.folders, tabs, session.itemTabBindings);
    if (bindingResult.changed) {
      await updateSession({ itemTabBindings: bindingResult.bindings });
    }
    set({ boundTabIds: Object.values(bindingResult.bindings) });
  }
}));
