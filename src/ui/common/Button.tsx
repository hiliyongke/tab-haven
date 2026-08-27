import type { ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-ghost' | 'soft';

const BUTTON_TONES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-on-accent hover:bg-accent-700',
  secondary: 'text-gray-600 hover:bg-gray-100',
  danger: 'bg-red-600 text-on-accent hover:opacity-90',
  'danger-ghost': 'text-red-600 hover:bg-red-50',
  soft: 'bg-accent-50 font-medium text-accent-600 hover:bg-accent-100'
};

/**
 * 统一按钮（弹窗/表单/工具条共用）。
 * 统一按钮变体，业务代码不写原子类。
 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  disabled,
  title,
  ariaLabel,
  onClick,
  children
}: {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  className?: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={
        'inline-flex items-center justify-center rounded text-sm transition-base disabled:cursor-default disabled:opacity-50 ' +
        /* 高度下限：sm 24px / md 32px。原 sm 用 py-0.5 实测约 22px，
           低于 WCAG 2.5.8 的 24px 最小目标尺寸。 */
        (size === 'sm' ? 'min-h-6 px-2 py-1' : 'min-h-8 px-3 py-1') +
        ' ' +
        BUTTON_TONES[variant] +
        (className ? ' ' + className : '')
      }
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
