import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * 列表键盘漫游：↑↓ 在给定序列中移动选中项，Enter 激活。
 *
 * 从 `useSearchController` 拆出。原实现把「漫游」与「搜索」耦合在一起，
 * 后果是**只有先输入才有键盘导航** —— 聚焦搜索框直接按 ↑↓ 毫无反应，
 * 而「列表 + 键盘」恰恰是产品的核心卖点（搜索态能漫游、全列表不能，是能力缺口）。
 *
 * 拆开后的契约：
 *  - 序列由调用方按当前态提供（搜索态 = 命中顺序，空态 = 可见列表顺序）；
 *  - 索引钳制、循环语义、Enter 激活只有一套实现，两态行为必然一致。
 */
export interface ListNavigation {
  /** 当前选中的标签 id（供列表高亮）。 */
  selectedTabId: number | undefined;
  /** 处理 ↑↓ / Enter；返回 true 表示按键已被消费（调用方可据此短路后续处理）。 */
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => boolean;
}

export function useListNavigation(params: {
  /** 当前态下的漫游序列（标签 id，按列表显示顺序）。 */
  tabIds: readonly number[];
  /**
   * 序列「换了一批」的信号（如查询词变化）：变化时选中项回到首项，
   * 避免沿用上一批的索引（表现为选中一个语义无关的项）。
   */
  resetKey: unknown;
  onActivate: (tabId: number) => void;
}): ListNavigation {
  const { tabIds, resetKey, onActivate } = params;
  const [index, setIndex] = useState(0);

  // 换批时回到首项
  useEffect(() => {
    setIndex(0);
  }, [resetKey]);

  // 序列收缩（标签被关闭 / 命中变少）时钳制索引：越界的选中项为 undefined，
  // 表现为高亮消失且 Enter 无动作。
  useEffect(() => {
    setIndex((current) => (tabIds.length === 0 ? 0 : Math.min(current, tabIds.length - 1)));
  }, [tabIds.length]);

  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): boolean => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (tabIds.length === 0) return false;
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setIndex((current) => (current + delta + tabIds.length) % tabIds.length);
        return true;
      }
      if (event.key === 'Enter') {
        const tabId = tabIds[index];
        if (tabId === undefined) return false;
        event.preventDefault();
        onActivateRef.current(tabId);
        return true;
      }
      return false;
    },
    [tabIds, index]
  );

  return { selectedTabId: tabIds[index], handleKeyDown };
}
