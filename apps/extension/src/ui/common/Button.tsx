import type { ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-ghost' | 'soft' | 'soft-outline';

/**
 * 每段末尾的 `disabled:hover:*` 不是冗余：原生 `<button disabled>` 在 Chrome 里
 * **仍然匹配 :hover**，禁用态会继续播放 hover 变色（主按钮 hover 更深，看着像还能点）。
 * 须显式把 hover 值回落到静态值（逐个组件打补丁会漏）。
 */
const BUTTON_TONES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-on-accent hover:bg-accent-700 disabled:hover:bg-accent-600',
  secondary: 'text-gray-600 hover:bg-gray-100 disabled:hover:bg-transparent',
  // 走 red-700 令牌而非 opacity：全站唯一用透明度表达 hover 的变体，
  // 与其余五个变体的「换一档底色」口径不一致。
  danger: 'bg-red-600 text-on-accent hover:bg-red-700 disabled:hover:bg-red-600',
  'danger-ghost': 'text-red-600 hover:bg-red-50 disabled:hover:bg-transparent',
  soft: 'bg-accent-50 font-medium text-accent-600 hover:bg-accent-100 disabled:hover:bg-accent-50',
  // 带边框的 soft：空态/引导块里的次级按钮需要可见边界，
  // 无边框的色块在浅色背景上分不清是按钮还是提示条。
  'soft-outline':
    'border border-accent-300 bg-accent-50 font-medium text-accent-700 hover:bg-accent-100 disabled:hover:bg-accent-50'
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
  size?: 'xs' | 'sm' | 'md';
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
        /* cursor-pointer：Tailwind v4 preflight 不再为按钮默认提供手型光标，须显式声明 */
        'inline-flex items-center justify-center rounded transition-base cursor-pointer disabled:cursor-default disabled:opacity-50 ' +
        /* 高度下限：xs/sm 24px / md 32px。原 sm 用 py-0.5 实测约 22px，
           低于 WCAG 2.5.8 的 24px 最小目标尺寸。
           xs 只比 sm 小在字号（text-2xs，窄侧栏空态原版就是这一档），
           高度仍守 24px —— 复用统一按钮不该以牺牲最小点击区域为代价。 */
        (size === 'xs'
          ? 'min-h-6 px-2 py-1 text-2xs'
          : size === 'sm'
            ? 'min-h-6 px-2 py-1 text-sm'
            : 'min-h-8 px-3 py-1 text-sm') +
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
