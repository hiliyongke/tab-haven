import { useEffect, useState } from 'react';
import type { TabRecord } from '@/core/tab-types';
import { queryAllWindowTabs } from '@/platform/tabs';
import { useTabStore } from '@/stores/tabStore';

/**
 * 全窗口搜索数据源：开关开启且输入非空时，异步补充其他窗口标签（120ms 防抖）；
 * 否则恒为空数组（搜索退化为仅当前窗口）。sidepanel 与 popup 共用，替代两处重复 effect。
 */
export function useAllWindowTabs(enabled: boolean, query: string): TabRecord[] {
  const [otherTabs, setOtherTabs] = useState<TabRecord[]>([]);
  const currentWindowId = useTabStore((state) => state.currentWindowId);

  useEffect(() => {
    if (!enabled || !query.trim()) {
      // 保持空态引用稳定：搜索框每击键都会重跑本 effect，
      // 恒新 [] 会让下游 useMemo/渲染每击键白跑一次。
      setOtherTabs((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void queryAllWindowTabs()
        .then((all) => {
          if (!cancelled) {
            setOtherTabs(all.filter((tab) => tab.windowId !== currentWindowId && !tab.incognito));
          }
        })
        .catch(() => {
          if (!cancelled) setOtherTabs([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, query, currentWindowId]);

  return otherTabs;
}
