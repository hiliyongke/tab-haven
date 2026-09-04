import type { ReactNode } from 'react';

/**
 * 行内操作按钮容器。
 * - 默认（forceVisible=false）：max-width 0 → 150px 展开（悬停/聚焦触发，
 *   main.css .row-actions），参与 flex 布局 —— 标题自动收缩省略，与按钮零重叠；
 * - forceVisible：静态常显占位（用户设置"操作按钮常显"时保留布局宽度）。
 */
export function RowActions({
  forceVisible = false,
  children
}: {
  forceVisible?: boolean;
  children: ReactNode;
}) {
  if (forceVisible) {
    return <span className="flex shrink-0 items-center gap-0.5">{children}</span>;
  }
  return <span className="row-actions">{children}</span>;
}
