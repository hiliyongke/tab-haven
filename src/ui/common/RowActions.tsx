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
    /* 仍挂 .row-actions 基类：此前这档是裸 flex，既没有 max-width 收放，
       也享受不到 ≤300px 档的 118px 收窄 —— 五个按钮常驻刚性占位约 110px，
       叠加徽章后窄档下标题直接归零。这里改为常显但不参与宽度塌陷。 */
    return <span className="row-actions row-actions--static">{children}</span>;
  }
  return <span className="row-actions">{children}</span>;
}
