import type { ReactNode } from 'react';

/**
 * 通用空态（sidepanel / popup 共用）：图标 + 标题 + 提示 + 可选动作。
 * 遵循「说明原因 + 提供下一步操作」的 UX 规范。
 */
export function EmptyState({
  icon,
  title,
  hint,
  action
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
      {icon && (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          {icon}
        </span>
      )}
      <p className="text-xs font-medium text-gray-600">{title}</p>
      {hint && <p className="max-w-52 text-2xs text-gray-600">{hint}</p>}
      {action}
    </div>
  );
}
