import { create } from 'zustand';
import {
  mergeSnapshotTabs,
  type TabGroupRecord,
  type TabRecord
} from '@/core/tab-types';
import {
  activateTab as activateTabPlatform,
  closeTabs as closeTabsPlatform,
  createNewTab as createNewTabPlatform,
  discardTab as discardTabPlatform,
  duplicateTab as duplicateTabPlatform,
  moveGroup as moveGroupPlatform,
  recolorGroup as recolorGroupPlatform,
  renameGroup as renameGroupPlatform,
  setGroupCollapsed as setGroupCollapsedPlatform,
  toggleMute as toggleMutePlatform,
  togglePinned as togglePinnedPlatform
} from '@/platform/tabs';
import { TabSyncService } from '@/platform/sync/TabSyncService';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { structuralSignature } from '@/core/util/signature';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { useDataStore } from '@/stores/dataStore';

/**
 * 标签镜像 store：真相源在浏览器，TabSyncService 把事件流统一为快照广播，
 * store 只做「快照 → 订阅者」的镜像中转。
 */

interface TabState {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  currentWindowId: number | undefined;
  /** 当前浏览器高亮（多选区）的标签 id 集合，与 tabs.onHighlighted 同步。 */
  highlightedIds: ReadonlySet<number>;
  /** 切换标签（点击行为）。 */
  activateTab: (tabId: number) => Promise<void>;
  /** 关闭标签，返回实际成功的标签 id（撤销联动由调用方编排）。 */
  closeTabs: (tabIds: readonly number[]) => Promise<number[]>;
  /** 切换静音。 */
  toggleMute: (tab: TabRecord) => Promise<void>;
  /** 切换固定。 */
  togglePinned: (tab: TabRecord) => Promise<void>;
  /** 折叠/展开原生组。 */
  setGroupCollapsed: (groupId: number, collapsed: boolean) => Promise<void>;
  /** 在当前窗口新建标签。 */
  createNewTab: () => Promise<void>;
  /** 复制单个标签（对标浏览器原生右键「复制标签页」）。 */
  duplicateTab: (tabId: number) => Promise<void>;
  /** 冻结（休眠）单个标签以释放内存，返回是否成功。 */
  discardTab: (tabId: number) => Promise<boolean>;
  /** 同步浏览器高亮选区。 */
  setHighlighted: (tabIds: readonly number[]) => void;
  /** 记录单个标签探测到的语言。 */
  setLanguage: (tabId: number, lang: string) => void;
  /** 重命名原生组。 */
  renameGroup: (groupId: number, title: string) => Promise<void>;
  /** 改变原生组颜色。 */
  recolorGroup: (groupId: number, color: string) => Promise<void>;
  /** 移动原生组到指定索引（组排序）。 */
  moveGroup: (groupId: number, index: number) => Promise<void>;
  /** 启动同步服务（组件挂载时调用一次）；返回清理函数。 */
  startTabSync: () => () => void;
}

const tabSyncService = new TabSyncService();

export const useTabStore = create<TabState>()((set, get) => ({
  tabs: [],
  groups: [],
  currentWindowId: undefined,
  highlightedIds: new Set<number>(),

  activateTab: async (tabId) => {
    await activateTabPlatform(tabId);
  },

  closeTabs: (tabIds) => closeTabsPlatform(tabIds),

  toggleMute: async (tab) => {
    await toggleMutePlatform(tab.id, Boolean(tab.muted));
  },

  togglePinned: async (tab) => {
    await togglePinnedPlatform(tab.id, tab.pinned);
  },

  setGroupCollapsed: async (groupId, collapsed) => {
    await setGroupCollapsedPlatform(groupId, collapsed);
  },

  createNewTab: async () => {
    const position = useDataStore.getState().settings.newTabPosition;
    await createNewTabPlatform(get().currentWindowId, position);
  },

  duplicateTab: async (tabId) => {
    // 显式复制须先申请复用豁免：uniqueUrlTabs 开启时，副本若不豁免
    // 会被复用引擎合并关闭（用户看到「已复制」但标签并不存在）。
    const source = get().tabs.find((tab) => tab.id === tabId);
    const key = source ? webComparisonKey(source.url, source.pendingUrl) : null;
    if (source && key) await grantReuseAllowance(source.windowId, key);
    await duplicateTabPlatform(tabId);
  },

  discardTab: (tabId) => discardTabPlatform(tabId),

  setHighlighted: (tabIds) => {
    set({ highlightedIds: new Set(tabIds) });
  },

  setLanguage: (tabId, lang) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return {};
      const current = state.tabs[idx];
      if (!current || current.language === lang) return {};
      const tabs = state.tabs.slice();
      tabs[idx] = { ...current, language: lang };
      return { tabs };
    });
  },

  renameGroup: async (groupId, title) => {
    await renameGroupPlatform(groupId, title);
  },

  recolorGroup: async (groupId, color) => {
    await recolorGroupPlatform(groupId, color);
  },

  moveGroup: async (groupId, index) => {
    await moveGroupPlatform(groupId, index);
  },

  startTabSync: () =>
    tabSyncService.start((snapshot) => {
      set((state) => {
        // 镜像增量合并（细节见 mergeSnapshotTabs）：语言按 id 保留（URL 变化需重探测）；
        // lastAccessed 对既有标签冻结——浏览器每次激活都会刷新该时间戳，照单全收
        // 会让「最近访问」排序随每次切换标签全量重排。冻结后排序只在「新页面打开」
        // （新 id 首次出现）时一次性纳入，其余操作零重排。
        const tabs = mergeSnapshotTabs(state.tabs, snapshot.tabs);
        // 内容守卫：事件空转（广播内容与本态一致）时跳过 set，避免顶层全量重渲染。
        if (
          state.currentWindowId === snapshot.windowId &&
          structuralSignature(tabs) === structuralSignature(state.tabs) &&
          structuralSignature(snapshot.groups) === structuralSignature(state.groups)
        ) {
          return {};
        }
        return { tabs, groups: snapshot.groups, currentWindowId: snapshot.windowId };
      });
    })
}));
