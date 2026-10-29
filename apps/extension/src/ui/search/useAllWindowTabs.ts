import { useMemo } from 'react';
import type { TabRecord } from '@/core/tab-types';
import { useOtherWindows } from '@/ui/tabs/useOtherWindows';

/**
 * 全窗口搜索数据源：开关开启且输入非空时返回其他窗口的标签（扁平），否则恒为空数组。
 *
 * 全窗口查询与「排除当前窗口 / 隐身窗口」由 `useOtherWindows` 唯一实现，这里只扁平化——
 * 两处各查一次会让同一份数据出现两种口径。
 *
 * 数据不随输入变化，故只随 tabs 事件刷新（500ms 节流）。返回顺序沿用 `useOtherWindows` 的窗口序
 * （含激活标签的窗口优先，其余按 windowId，窗口内按浏览器 index）。
 */

/** 空态复用同一引用：搜索框每击键都重渲染，恒新 [] 会让下游 useMemo 白跑。 */
const NO_TABS: TabRecord[] = [];

export function useAllWindowTabs(enabled: boolean, query: string): TabRecord[] {
  const active = enabled && query.trim().length > 0;
  const { otherWindows } = useOtherWindows(active);
  return useMemo(
    () => (active ? otherWindows.flatMap((window) => window.tabs) : NO_TABS),
    [active, otherWindows]
  );
}
