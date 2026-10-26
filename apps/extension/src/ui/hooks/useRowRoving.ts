import { useCallback, type KeyboardEvent, type RefObject } from 'react';
import { findActivatableRows, ROW_ACTIVATABLE_ATTR } from '@/ui/domContract';

/**
 * 列表级键盘漫游（↑↓ / Home / End）：一个 Tab 进入列表后即可在行之间移动焦点。
 *
 * 否则 100 个标签就有上百个 Tab 停靠点（每行还带若干操作按钮），仅键盘与读屏
 * 用户几乎无法在列表里穿行。
 *
 * 刻意**不接管**带修饰键的按键：Alt+↑↓ 是键盘重排（改写浏览器 index），不能被
 * 漫游吞掉。输入框内的 ↑↓ 归搜索漫游（useListNavigation）所有，这里一律放行。
 *
 * 放 ui 层的理由：算法与 `ROW_ACTIVATABLE_ATTR` / `findActivatableRows` 的 DOM 约定
 * 是同一件事的两半 —— 分家后改选择器必漏一侧，表现为「方向键突然不动了」。
 *
 * @param containerRef 列表容器（漫游只在其内部的行之间移动）。
 */
export function useRowRoving(
  containerRef: RefObject<HTMLElement | null>
): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const container = containerRef.current;
      if (!container) return;
      const rows = findActivatableRows(container);
      if (rows.length === 0) return;
      const current = target.closest<HTMLElement>(`[${ROW_ACTIVATABLE_ATTR}]`);
      const index = current ? rows.indexOf(current) : -1;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? rows.length - 1
            : event.key === 'ArrowDown'
              ? index < 0
                ? 0
                : Math.min(index + 1, rows.length - 1)
              : index < 0
                ? rows.length - 1
                : Math.max(index - 1, 0);
      rows[next]?.focus();
      // 焦点移动时浏览器会自行滚动到该行，阻止方向键的默认滚动以免两者叠加
      event.preventDefault();
    },
    [containerRef]
  );
}
