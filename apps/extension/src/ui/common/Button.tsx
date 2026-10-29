import type { ReactNode } from 'react';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'secondary-outline'
  | 'ghost'
  | 'accent-ghost'
  | 'warn-ghost'
  | 'danger'
  | 'danger-ghost'
  | 'soft-outline';

/** 段尾 `disabled:hover:*` 非冗余：Chrome 里 `<button disabled>` 仍匹配 :hover，禁用态会继续
 *  播 hover 变色（看着像还能点），须显式把 hover 回落到静态值。 */
const BUTTON_TONES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-on-accent hover:bg-accent-700 disabled:hover:bg-accent-600',
  secondary: 'text-gray-600 hover:bg-gray-100 disabled:hover:bg-transparent',
  /* 描边次级：与 secondary 同骨架多一条可见边界。收进变体后「灰底还是白底描边」不再取决于
     Tailwind 输出顺序（调用点补 border + hover:bg-gray-50 会被 secondary 的 hover:bg-gray-100 覆盖）。 */
  'secondary-outline':
    'border border-control bg-surface font-medium text-gray-600 hover:bg-gray-50 disabled:hover:bg-surface',
  /* ghost / accent-ghost：无底色无边框的文字按钮。收进变体后 min-h 命中下限与 disabled:hover
     兜底与其余变体同源。 */
  ghost: 'text-gray-500 hover:bg-gray-100 disabled:hover:bg-transparent',
  /* 强调色文字按钮：与 ghost 同骨架只换强调色，不让调用方用 className 覆盖 ghost 的 text-gray-500
     （两个 text-* 同特异性，胜负取决于输出顺序）。 */
  'accent-ghost': 'font-medium text-accent-700 hover:bg-accent-100 disabled:hover:bg-transparent',
  /* 警示色文字按钮（告警横幅「重试」）：配色必须由变体给定。 */
  'warn-ghost': 'font-medium text-warn-700 hover:bg-warn-100 disabled:hover:bg-transparent',
  // 走 red-700 令牌而非 opacity：与其余变体「换一档底色」口径一致。
  danger: 'bg-red-600 text-on-accent hover:bg-red-700 disabled:hover:bg-red-600',
  'danger-ghost': 'text-red-600 hover:bg-red-50 disabled:hover:bg-transparent',
  // 带边框的 soft：空态/引导块里的次级按钮需要可见边界。
  'soft-outline':
    'border border-accent-300 bg-accent-50 font-medium text-accent-700 hover:bg-accent-100 disabled:hover:bg-accent-50'
};

/** 尺寸刻度：dense(11px) / xs(10px) / sm(14px) / md(14px)。dense 与 xs 只差字号：
 *  11px 是「正文说明」下限，10px 只给徽角/图标内文；收进变体避免调用点用 text-3xs 压 xs。 */
const BUTTON_SIZES = {
  dense: 'min-h-6 px-2 py-1 text-3xs',
  xs: 'min-h-6 px-2 py-1 text-2xs',
  sm: 'min-h-6 px-2 py-1 text-sm',
  md: 'min-h-8 px-3 py-1 text-sm'
} as const;

/** 统一按钮（弹窗/表单/工具条共用）：统一变体，业务代码不写原子类。 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  disabled,
  label,
  tooltip,
  onClick,
  children
}: {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  type?: 'button' | 'submit';
  className?: string;
  disabled?: boolean;
  /** 可访问名（icon-only 按钮必填）：落到 aria-label。有可见文字时可省略，此时由 children
   *  承担；传了 label 会以它为准（覆盖可见文字）。 */
  label?: string;
  /** 鼠标提示需要比可访问名更长时用它（缺省回落 label）。 */
  tooltip?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={
        /* cursor-pointer：Tailwind v4 preflight 不再为按钮默认提供手型光标，须显式声明 */
        'inline-flex items-center justify-center rounded transition-base cursor-pointer disabled:cursor-default disabled:opacity-50 ' +
        /* 高度下限：dense/xs/sm 24px / md 32px（WCAG 2.5.8），不以牺牲最小点击区域为代价。 */
        BUTTON_SIZES[size] +
        ' ' +
        BUTTON_TONES[variant] +
        (className ? ' ' + className : '')
      }
      disabled={disabled}
      title={tooltip ?? label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
