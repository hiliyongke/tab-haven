import type { ReactNode } from 'react';
import { Button } from '@/ui/common/Button';

/**
 * 次级文字按钮（「取消 / 从 OneTab 导入 / 本周周报」等同款入口）。
 *
 * 命中下限与视觉此前在四处各写一遍同样的 class 串：改一处（如 WCAG 2.5.8 的
 * 24px 下限从 py-1 抬到 min-h-6）要同步改四处，漏一处就留下一个 20px 的按钮，
 * 而这类缺陷只在无障碍审计里才暴露。现统一走 `Button variant="ghost" size="xs"`。
 */
export function TextButton({
  onClick,
  className = '',
  children
}: {
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button variant="ghost" size="xs" className={className} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * 洞察行动按钮（「清理重复 / 一键休眠 / 归档当前窗口」同款，见 TextButton 的收口理由）。
 *
 * `chip chip--cjk` 保留在调用侧：徽角字号由 `.chip` 统一（且它不在 Tailwind 的
 * utilities 层，不受 Button 的 text-2xs 影响），Button 只提供盒子与强调色。
 */
export function InsightActionButton({
  onClick,
  children
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="accent-ghost"
      size="xs"
      className="chip chip--cjk self-start"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
