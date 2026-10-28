import type { ReactNode } from 'react';
import { Button } from '@/ui/common/Button';

/**
 * 洞察行动按钮（「清理重复 / 一键休眠 / 归档当前窗口」同款）。
 *
 * `chip chip--cjk` 保留在调用侧：徽角字号由 `.chip` 统一（且它不在 Tailwind 的
 * utilities 层，不受 Button 的 text-2xs 影响），Button 只提供盒子与强调色。
 *
 * 此前的 `TextButton`（`variant="ghost" size="xs"` 的空壳）已删除：
 * 它只是同一形态的第二个名字，5 个调用点全部在 snapshot 模块内，
 * 直接写 Button 变体即可，少一层没有增益的间接。
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
