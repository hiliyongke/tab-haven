import type { ReactNode } from 'react';

/** 徽章色调：前景/背景组合须满足 WCAG AA，且只在此处定义。 */
export type ChipTone = 'neutral' | 'accent' | 'warn' | 'brand' | 'outline';

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  accent: 'bg-accent-100 text-accent-700',
  warn: 'bg-warn-100 text-warn-700',
  brand: 'bg-accent-50 text-accent-700',
  /* 描边档：可移除的标签（白名单条目）等需要「边界可见」的场合。 */
  outline: 'border border-gray-200 bg-gray-50 text-gray-600'
};

/** 尺寸：sm = 行内紧凑徽角；md = 独立胶囊。圆角与内距成对，避免同一视觉 role 出现两种形态。 */
const CHIP_SIZES = {
  sm: 'rounded px-1',
  md: 'rounded-full px-2 py-0.5'
};

/** 徽章（chip 语义类的组件化）：状态标记、来源标记、计数说明、隐私承诺胶囊共用。
 *  字号由 `.chip`/`.chip--cjk` 统一，组件不覆写 —— 含汉字传 `cjk` 拿 11px，纯数字/图标保持 10px。 */
export function Chip({
  tone = 'neutral',
  cjk = false,
  size = 'sm',
  className,
  title,
  label,
  onClick,
  children
}: {
  tone?: ChipTone;
  /** 含汉字时传 true（10px 下汉字笔画糊，见 main.css .chip--cjk 注释）。 */
  cjk?: boolean;
  /** sm = 行内徽角；md = 独立胶囊。 */
  size?: 'sm' | 'md';
  className?: string;
  /** 鼠标提示：缺省回落到 label。 */
  title?: string;
  /** 可访问名（aria-label）；无可见文字的图标徽章必填。 */
  label?: string;
  /** 传入即渲染为按钮（可点徽章，如「不再显示」）。 */
  onClick?: () => void;
  children?: ReactNode;
}) {
  const base =
    'chip ' +
    CHIP_SIZES[size] +
    ' ' +
    CHIP_TONES[tone] +
    (cjk ? ' chip--cjk' : '') +
    (className ? ' ' + className : '');
  const resolvedTitle = title ?? label;
  if (onClick) {
    return (
      <button
        type="button"
        className={base + ' cursor-pointer transition-base'}
        title={resolvedTitle}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={base} title={resolvedTitle} aria-label={label}>
      {children}
    </span>
  );
}
