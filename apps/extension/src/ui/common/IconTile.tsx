import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/common/Icon';

/**
 * 图标底座：带底色/描边的方形或圆形图标容器（空态插画、能力卡、入口卡共用）。
 *
 * 收口的缘由：同一形态此前有 4 种尺寸（28 / 32 / 36）与 3 种圆角（full / lg / xl），
 * 全靠各调用点各写一串 class —— 28 与 32 并存时，同一屏的卡片标题会「看起来一样大、
 * 图标却不一样大」。这里给三档尺寸与两种形状，圆角随形状固定，不再逐处决定。
 *
 * 页面头部那枚 36px + 描边 + elev-1 的徽标**不在此列**：它承担的是页面身份标识，
 * 带边框与投影，与列表里的纯色底座不是同一角色（见 SettingsPage 的 header）。
 */
const SIZES = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-9 w-9'
} as const;

const SHAPES = {
  square: 'rounded-lg',
  circle: 'rounded-full'
} as const;

const TONES = {
  accent: 'bg-accent-50 text-accent-600',
  neutral: 'bg-gray-100 text-gray-600'
} as const;

export function IconTile({
  icon,
  size = 'md',
  shape = 'square',
  tone = 'accent',
  className,
  children
}: {
  /** 图标组件；给了 children 则以 children 为准（如自定义 svg / 旋转箭头）。 */
  icon?: LucideIcon;
  size?: keyof typeof SIZES;
  shape?: keyof typeof SHAPES;
  tone?: keyof typeof TONES;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={
        'grid shrink-0 place-items-center ' +
        SIZES[size] +
        ' ' +
        SHAPES[shape] +
        ' ' +
        TONES[tone] +
        (className ? ' ' + className : '')
      }
    >
      {children ?? (icon ? <Icon d={icon} className="h-4 w-4" /> : null)}
    </span>
  );
}
