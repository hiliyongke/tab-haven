import type { ReactNode } from 'react';
import { Button } from '@/ui/common/Button';

/**
 * 洞察行动按钮（「清理重复 / 一键休眠 / 归档当前窗口」同款）。
 *
 * `chip chip--cjk` 保留在调用侧：徽角字号由 `.chip` 统一（且它不在 Tailwind 的
 * utilities 层，不受 Button 的 text-2xs 影响），Button 只提供盒子与强调色。
 *
 * 没有独立的 TextButton：它只是同一形态的第二个名字，直接用 Button 变体即可。
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
