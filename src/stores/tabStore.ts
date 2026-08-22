import { create } from 'zustand';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import {
  activateTab as activateTabPlatform,
  closeTabs as closeTabsPlatform,
  createGroup as createGroupPlatform,
  createNewTab as createNewTabPlatform,
  createTabInGroup as createTabInGroupPlatform,
  discardTab as discardTabPlatform,
  duplicateTab as duplicateTabPlatform,
  goBack as goBackPlatform,
  goForward as goForwardPlatform,
  highlightTabs as highlightTabsPlatform,
  moveGroup as moveGroupPlatform,
  queryCurrentWindowGroups,
  queryCurrentWindowTabs,
  recolorGroup as recolorGroupPlatform,
  removeGroup as removeGroupPlatform,
  renameGroup as renameGroupPlatform,
  setGroupCollapsed as setGroupCollapsedPlatform,
  toggleMute as toggleMutePlatform,
  togglePinned as togglePinnedPlatform
} from '@/platform/tabs';
import { TabSyncService } from '@/platform/sync/TabSyncService';

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
  /** 快照代数（来自 TabSyncService，用于判断数据新鲜度）。 */
  generation: number;
  /** 标签预览缩略图缓存（tabId → dataURL），按激活标签截图填充。 */
  previews: ReadonlyMap<number, string>;
  /** 当前浏览器高亮（多选区）的标签 id 集合，与 tabs.onHighlighted 同步。 */
  highlightedIds: ReadonlySet<number>;
  /** 切换标签（点击行为）。 */
  activateTab: (tabId: number) => Promise<void>;
  /** 关闭标签（撤销联动由调用方编排）。 */
  closeTabs: (tabIds: readonly number[]) => Promise<void>;
  /** 切换静音。 */
  toggleMute: (tab: TabRecord) => Promise<void>;
  /** 切换固定。 */
  togglePinned: (tab: TabRecord) => Promise<void>;
  /** 折叠/展开原生组。 */
  setGroupCollapsed: (groupId: number, collapsed: boolean) => Promise<void>;
  /** 在原生组内新建标签。 */
  createTabInGroup: (groupId: number) => Promise<void>;
  /** 在当前窗口新建标签。 */
  createNewTab: () => Promise<void>;
  /** 复制单个标签（对标浏览器原生右键「复制标签页」）。 */
  duplicateTab: (tabId: number) => Promise<void>;
  /** 冻结（休眠）单个标签以释放内存。 */
  discardTab: (tabId: number) => Promise<void>;
  /** 缓存标签预览缩略图。 */
  setPreview: (tabId: number, dataUrl: string) => void;
  /** 删除已不存在标签的预览缓存。 */
  prunePreviews: (tabIds: ReadonlySet<number>) => void;
  /** 同步浏览器高亮选区。 */
  setHighlighted: (tabIds: readonly number[]) => void;
  /** 记录单个标签探测到的语言。 */
  setLanguage: (tabId: number, lang: string) => void;
  /** 新建命名原生组（可附带初始成员），返回组 id。 */
  createGroup: (title: string, color?: string, tabIds?: readonly number[]) => Promise<number | undefined>;
  /** 重命名原生组。 */
  renameGroup: (groupId: number, title: string) => Promise<void>;
  /** 改变原生组颜色。 */
  recolorGroup: (groupId: number, color: string) => Promise<void>;
  /** 删除原生组（组内标签解散，不关闭）。 */
  removeGroup: (groupId: number) => Promise<void>;
  /** 移动原生组到指定索引（组排序）。 */
  moveGroup: (groupId: number, index: number) => Promise<void>;
  /** 激活标签后退（Chrome 114+）。 */
  goBack: (tabId: number) => Promise<void>;
  /** 激活标签前进（Chrome 114+）。 */
  goForward: (tabId: number) => Promise<void>;
  /** 高亮多个标签（与浏览器多选同步）。 */
  highlightTabs: (tabIds: readonly number[]) => Promise<void>;
  /** 启动同步服务（组件挂载时调用一次）；返回清理函数。 */
  startTabSync: () => () => void;
}

const tabSyncService = new TabSyncService();

export const useTabStore = create<TabState>()((set, get) => ({
  tabs: [],
  groups: [],
  currentWindowId: undefined,
  generation: 0,
  previews: new Map<number, string>(),
  highlightedIds: new Set<number>(),

  activateTab: async (tabId) => {
    await activateTabPlatform(tabId);
  },

  closeTabs: async (tabIds) => {
    await closeTabsPlatform(tabIds);
  },

  toggleMute: async (tab) => {
    await toggleMutePlatform(tab.id, Boolean(tab.muted));
  },

  togglePinned: async (tab) => {
    await togglePinnedPlatform(tab.id, tab.pinned);
  },

  setGroupCollapsed: async (groupId, collapsed) => {
    await setGroupCollapsedPlatform(groupId, collapsed);
  },

  createTabInGroup: async (groupId) => {
    const windowId = get().currentWindowId;
    if (windowId === undefined) return;
    await createTabInGroupPlatform(groupId, windowId);
  },

  createNewTab: async () => {
    await createNewTabPlatform(get().currentWindowId);
  },

  duplicateTab: async (tabId) => {
    await duplicateTabPlatform(tabId);
  },

  discardTab: async (tabId) => {
    await discardTabPlatform(tabId);
  },

  setPreview: (tabId, dataUrl) => {
    set((state) => {
      const next = new Map(state.previews);
      next.set(tabId, dataUrl);
      return { previews: next };
    });
  },

  prunePreviews: (tabIds: ReadonlySet<number>) => {
    set((state) => {
      const next = new Map([...state.previews].filter(([tabId]) => tabIds.has(tabId)));
      return next.size === state.previews.size ? {} : { previews: next };
    });
  },

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

  createGroup: async (title, color, tabIds) => {
    return createGroupPlatform(title, color, tabIds);
  },

  renameGroup: async (groupId, title) => {
    await renameGroupPlatform(groupId, title);
  },

  recolorGroup: async (groupId, color) => {
    await recolorGroupPlatform(groupId, color);
  },

  removeGroup: async (groupId) => {
    await removeGroupPlatform(groupId);
  },

  moveGroup: async (groupId, index) => {
    await moveGroupPlatform(groupId, index);
  },

  goBack: async (tabId) => {
    await goBackPlatform(tabId);
  },

  goForward: async (tabId) => {
    await goForwardPlatform(tabId);
  },

  highlightTabs: async (tabIds) => {
    await highlightTabsPlatform(tabIds);
  },

  startTabSync: () =>
    tabSyncService.start((snapshot) => {
      set((state) => {
        // 清理已关闭标签的预览缓存，避免截图 dataURL 无限驻留
        let previews = state.previews;
        if (previews.size > 0) {
          const liveIds = new Set(snapshot.tabs.map((tab) => tab.id));
          const filtered = new Map([...previews].filter(([id]) => liveIds.has(id)));
          if (filtered.size !== previews.size) previews = filtered;
        }
        return {
          tabs: snapshot.tabs,
          groups: snapshot.groups,
          currentWindowId: snapshot.windowId,
          generation: snapshot.generation,
          previews
        };
      });
    })
}));

/** 保留引用以便需要手动重查的场景。 */
export async function refreshTabSnapshot(): Promise<void> {
  const [tabs, groups] = await Promise.all([queryCurrentWindowTabs(), queryCurrentWindowGroups()]);
  useTabStore.setState({ tabs, groups, currentWindowId: tabs[0]?.windowId });
}
