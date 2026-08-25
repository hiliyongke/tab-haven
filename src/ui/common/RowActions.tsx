import type { ReactNode } from 'react';

/**
 * 行内操作按钮容器。
 * - 默认（forceVisible=false）：绝对定位浮层，悬停/聚焦时 opacity 淡入，
 *   不参与布局 —— 标题区零位移（替代旧 w-0→w-auto 的宽度挤压与不可过渡问题），
 *   左缘用渐变淡出到行底色（--row-bg，由各状态规则同步赋值），盖住长标题不突兀；
 * - forceVisible：回归静态占位（用户设置"操作按钮常显"时保留布局宽度）。
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
