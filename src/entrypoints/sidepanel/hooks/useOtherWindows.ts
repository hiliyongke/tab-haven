import { useEffect, useMemo, useState } from 'react';
import type { TabRecord } from '@/core/tab-types';
import { onAllTabsChanged, queryAllWindowTabs } from '@/platform/tabs';
import { useTabStore } from '@/stores/tabStore';

/**
 * 其他窗口数据源（A4 多窗口分段）。
 *
 * 刻意不进 tabStore：现有 store 以「当前窗口」为唯一契约（分区、排序、撤销、
 * 拖拽全部围绕它），把多窗口塞进去会动摇全部消费方。本 hook 独立持有
 * 全窗口快照，只服务展示层；查询失败保持旧数据（下次事件再试）。
 *
 * 刷新信号：onAllTabsChanged（全局 tabs 事件）+ 500ms 节流（onUpdated 高频）。
 */
export interface OtherWindow {
  windowId: number;
  /** 该窗口全部标签（按浏览器 index 排序）。 */
  tabs: TabRecord[];
  /** 该窗口是否含激活标签（含聚焦窗口排前）。 */
  hasActive: boolean;
}

export function useOtherWindows(enabled: boolean): { otherWindows: OtherWindow[] } {
  const currentWindowId = useTabStore((state) => state.currentWindowId);
  const [allTabs, setAllTabs] = useState<TabRecord[]>([]);

  useEffect(() => {
    if (!enabled) return; // 关闭时不查询、不订阅全局事件
    let cancelled = false;
    const refreshSafely = () => {
      void queryAllWindowTabs()
        .then((tabs) => {
          if (!cancelled) setAllTabs(tabs);
        })
        .catch(() => {
          // 查询失败保持旧数据
        });
    };
    refreshSafely();
    // 500ms 节流：onUpdated 每标签导航触发多次，直接重查会放大成事件风暴。
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        refreshSafely();
      }, 500);
    };
    const detach = onAllTabsChanged(schedule);
    return () => {
      cancelled = true;
      detach();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);

  const otherWindows = useMemo(() => {
    const byWindow = new Map<number, TabRecord[]>();
    for (const tab of allTabs) {
      if (tab.windowId === currentWindowId) continue;
      // 隐身窗口一律排除：面板不得明文展示隐身标签的标题/网址
      // （与 useAllWindowTabs / folderSlice / Reconcile 等既有口径一致）。
      if (tab.incognito) continue;
      const list = byWindow.get(tab.windowId);
      if (list) list.push(tab);
      else byWindow.set(tab.windowId, [tab]);
    }
    return (
      [...byWindow.entries()]
        .map(([windowId, tabs]) => ({
          windowId,
          tabs: [...tabs].sort((a, b) => a.index - b.index),
          hasActive: tabs.some((tab) => tab.active)
        }))
        // 含激活标签（=用户正看着）的窗口排前，其余按 id 稳定排序。
        .sort((a, b) => Number(b.hasActive) - Number(a.hasActive) || a.windowId - b.windowId)
    );
  }, [allTabs, currentWindowId]);

  return { otherWindows };
}
