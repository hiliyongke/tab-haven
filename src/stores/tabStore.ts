import { create } from 'zustand';
import type { TabRecord } from '@/core/tab-types';
import { activateTab as activateTabPlatform } from '@/platform/tabs';
import { TabSyncService } from '@/platform/sync/TabSyncService';

/**
 * 标签镜像 store（docs/ARCHITECTURE.md 5.5）。
 *
 * 唯一标签真相源在浏览器；TabSyncService 把事件流统一为快照广播，
 * store 只做"快照 → 订阅者"的镜像中转（单次 set，React selector 订阅）。
 */

interface TabState {
  /** 标签镜像（不可变快照，只读消费）。 */
  tabs: readonly TabRecord[];
  currentWindowId: number | undefined;
  /** 快照代数（来自 TabSyncService，用于判断数据新鲜度）。 */
  generation: number;
  /** 切换标签（点击行为）。 */
  activateTab: (tabId: number) => Promise<void>;
  /** 启动同步服务（组件挂载时调用一次）；返回清理函数。 */
  startTabSync: () => () => void;
}

const tabSyncService = new TabSyncService();

export const useTabStore = create<TabState>()((set) => ({
  tabs: [],
  currentWindowId: undefined,
  generation: 0,

  activateTab: async (tabId) => {
    await activateTabPlatform(tabId);
  },

  startTabSync: () =>
    tabSyncService.start((snapshot) => {
      set({
        tabs: snapshot.tabs,
        currentWindowId: snapshot.windowId,
        generation: snapshot.generation
      });
    })
}));
