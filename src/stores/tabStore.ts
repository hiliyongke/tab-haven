import { create } from 'zustand';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
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
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { useDataStore } from '@/stores/dataStore';

/**
 * 标签镜像 store（docs/ARCHITECTURE.md 5.5）。
 *
 * 唯一标签真相源在浏览器；TabSyncService 把事件流统一为快照广播，
 * store 只做"快照 → 订阅者"的镜像中转（单次 set，React selector 订阅）。
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
        // 语言是面板侧异步探测的增量信息（chrome.tabs.Tab 无此字段），快照广播不含语言：
        // 按 id 保留既有探测结果（URL 变化说明已导航，语言需重新探测，不保留旧值），
        // 否则每次广播都会清空语言并触发 App 全量重探测。
        const prevById = new Map(state.tabs.map((tab) => [tab.id, tab]));
        const tabs = snapshot.tabs.map((tab) => {
          const prev = prevById.get(tab.id);
          if (!prev || prev.language === undefined) return tab;
          if (prev.url !== tab.url || prev.pendingUrl !== tab.pendingUrl) return tab;
          return { ...tab, language: prev.language };
        });
        // 内容守卫：事件空转（广播内容与本态一致）时跳过 set，避免顶层全量重渲染。
        if (
          state.currentWindowId === snapshot.windowId &&
          JSON.stringify(tabs) === JSON.stringify(state.tabs) &&
          JSON.stringify(snapshot.groups) === JSON.stringify(state.groups)
        ) {
          return {};
        }
        return { tabs, groups: snapshot.groups, currentWindowId: snapshot.windowId };
      });
    })
}));
