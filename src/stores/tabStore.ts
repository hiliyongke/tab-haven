import { create } from 'zustand';
import type { TabRecord } from '@/core/tab-types';
import {
  activateTab as activateTabPlatform,
  queryCurrentWindowTabs,
  startTabEventAggregator
} from '@/platform/tabs';

/**
 * 标签镜像 store（docs/ARCHITECTURE.md 5.5）。
 *
 * 唯一标签真相源在浏览器；store 是镜像快照：
 * chrome 事件（聚合器 40ms 防抖）→ 重查询 → 单次 set → React selector 订阅。
 */
interface TabState {
  tabs: TabRecord[];
  currentWindowId: number | undefined;
  /** 查询当前窗口标签并刷新镜像（初始化与事件驱动路径共用）。 */
  refreshTabs: () => Promise<void>;
  /** 切换标签（点击行为）。 */
  activateTab: (tabId: number) => Promise<void>;
  /** 启动事件聚合器（组件挂载时调用一次）；返回清理函数。 */
  startEventSync: () => () => void;
}

export const useTabStore = create<TabState>()((set) => ({
  tabs: [],
  currentWindowId: undefined,

  refreshTabs: async () => {
    const tabs = await queryCurrentWindowTabs();
    set({ tabs, currentWindowId: tabs[0]?.windowId });
  },

  activateTab: async (tabId) => {
    await activateTabPlatform(tabId);
  },

  startEventSync: () =>
    startTabEventAggregator(() => {
      void queryCurrentWindowTabs()
        .then((tabs) => set({ tabs }))
        .catch(console.error);
    })
}));
