import type { ReactNode } from 'react';

/**
 * 通用空态（侧边栏与设置页共用）：图标 + 标题 + 提示 + 可选动作。
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
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          {icon}
        </span>
      )}
      <p className="text-xs font-medium text-gray-600">{title}</p>
      {/* 提示与标题降一级色：同色时层级只靠 1px 字号差撑着，
          而「降层级应靠字号与留白、不靠降对比度」的反面正是这里。 */}
      {hint && <p className="max-w-52 text-3xs text-gray-500">{hint}</p>}
      {action}
    </div>
  );
}
