import { create } from 'zustand';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import {
  activateTab as activateTabPlatform,
  closeTabs as closeTabsPlatform,
  createNewTab as createNewTabPlatform,
  createTabInGroup as createTabInGroupPlatform,
  queryCurrentWindowGroups,
  queryCurrentWindowTabs,
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
  /** 启动同步服务（组件挂载时调用一次）；返回清理函数。 */
  startTabSync: () => () => void;
}

const tabSyncService = new TabSyncService();

export const useTabStore = create<TabState>()((set, get) => ({
  tabs: [],
  groups: [],
  currentWindowId: undefined,
  generation: 0,

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

  startTabSync: () =>
    tabSyncService.start((snapshot) => {
      set({
        tabs: snapshot.tabs,
        groups: snapshot.groups,
        currentWindowId: snapshot.windowId,
        generation: snapshot.generation
      });
    })
}));

/** 保留引用以便需要手动重查的场景。 */
export async function refreshTabSnapshot(): Promise<void> {
  const [tabs, groups] = await Promise.all([queryCurrentWindowTabs(), queryCurrentWindowGroups()]);
  useTabStore.setState({ tabs, groups, currentWindowId: tabs[0]?.windowId });
}
