import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TabRecord } from '@/core/tab-types';
import { onAllTabsChanged, queryAllWindowTabs } from '@/platform/tabs';
import { logDegraded } from '@/platform/diagnostics';
import { useTabStore } from '@/stores/tabStore';

/**
 * 其他窗口数据源（A4 多窗口分段）。
 *
 * 刻意不进 tabStore：现有 store 以「当前窗口」为唯一契约（分区、排序、撤销、
 * 拖拽全部围绕它），把多窗口塞进去会动摇全部消费方。本 hook 独立持有
 * 全窗口快照，只服务展示层；查询失败保持旧数据（下次事件再试），并向外暴露
 * status 供展示层区分「没有其他窗口」与「一直在查询失败」（此前二者同为空白）。
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

/** 其他窗口查询的展示态：loading=首帧在途、ready=已拿到快照、error=最近一次查询失败。 */
export type OtherWindowsStatus = 'loading' | 'ready' | 'error';

export function useOtherWindows(enabled: boolean): {
  otherWindows: OtherWindow[];
  status: OtherWindowsStatus;
  /** 手动重试（错误态出口）：重新触发一次全窗口查询。 */
  retry: () => void;
} {
  const currentWindowId = useTabStore((state) => state.currentWindowId);
  const [allTabs, setAllTabs] = useState<TabRecord[]>([]);
  /**
   * 查询态。首帧在途为 loading；成功后转 ready；失败转 error。
   *
   * 此前失败分支是空的 catch（保持旧数据），调用方无法区分「没有其他窗口」与
   * 「查询一直失败」——两种情况下该区域都渲染成永久空白。这里把态显式暴露出去。
   * 注意：失败仍保留旧数据（下次事件再试），所以 error 态下 otherWindows 可能是
   * 上一次成功的结果——展示层据此优先渲染错误提示，避免「有数据但其实是坏的」。
   */
  const [status, setStatus] = useState<OtherWindowsStatus>('loading');
  // 重试信号：递增即可触发一次重查（不存布尔，布尔在连续两次重试时不会变化）。
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!enabled) return; // 关闭时不查询、不订阅全局事件
    let cancelled = false;
    // 开关由关→开（或重试）时重新进入查询：必须先回到 loading，
    // 否则上一次的 error 会一直挂着，用户点了重试却看不到任何变化。
    setStatus('loading');
    const refreshSafely = () => {
      void queryAllWindowTabs()
        .then((tabs) => {
          if (cancelled) return;
          setAllTabs(tabs);
          setStatus('ready');
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          // 查询失败保持旧数据（下次事件再试），但必须把态置为 error，
          // 否则「没有任何其他窗口」与「一直在失败」在 UI 上无法分辨。
          logDegraded('windows', '其他窗口查询失败', error);
          setStatus('error');
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
  }, [enabled, retryTick]);

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

  /**
   * 错误态的手动出口：递增重试信号重跑 effect。
   * 用 useCallback 固定引用：作为 prop 传给 memo 化的展示组件时不触发多余重渲染。
   */
  const retry = useCallback(() => {
    setStatus('loading');
    setRetryTick((tick) => tick + 1);
  }, []);

  return { otherWindows, status, retry };
}
