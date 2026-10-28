import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/common/Icon';

/**
 * 提示块（带色底的说明条）：落盘失败横幅、能力发现 Tip、窗口读取失败、
 * 快照找回引导、崩溃引导、备份提醒、周报引导共用。
 *
 * 收口的缘由：这一形态此前在 6 个文件里各写一串 class —— 内距有
 * `px-2 / px-2.5 / px-3 / py-2 / py-2.5` 四种组合，底色有三种（含一种只有描边没有底），
 * 于是同样语义的说明块左边缘分别落在 8 / 10 / 12px，一屏里能同时看到两种。
 *
 * 两个 density 是刻意保留的两档，不是历史包袱：
 * - `panel`：侧栏 320px 宽，内距小一档（px-2.5 py-2），避免内容区被挤成两行；
 * - `page`：整页/弹窗 600px 以上，内距大一档（px-3 py-2.5）。
 * 同一 density 内只允许这一套，不再由调用点各自决定。
 *
 * 字号与行高留给 children：这些块里既有 11px 正文，也有 12px 的撤销行说明，
 * 统一压成一个字号会让其中一类变得难读。容器只负责「盒子 + 色调 + 图标位」。
 */
type CalloutTone = 'accent' | 'warn' | 'plain';
type CalloutDensity = 'panel' | 'page';

const TONES: Record<CalloutTone, string> = {
  accent: 'border-accent-200 bg-accent-50 text-accent-700',
  warn: 'border-warn-200 bg-warn-50 text-warn-700',
  /* plain：只有描边、不铺底色（引导弹窗终步用）—— 弹窗本身已是强调面，
     再叠一层色块会把「跳过 / 下一步」的层级压掉。 */
  plain: 'border-accent-200'
};

const DENSITIES: Record<CalloutDensity, string> = {
  panel: 'gap-2 px-2.5 py-2',
  page: 'gap-2 px-3 py-2.5'
};

const ICON_TONES: Record<CalloutTone, string> = {
  accent: 'text-accent-600',
  warn: 'text-warn-600',
  plain: 'text-accent-600'
};

export function Callout({
  tone = 'accent',
  density = 'panel',
  layout = 'inline',
  align = 'start',
  icon,
  action,
  className,
  children,
  ...rest
}: {
  tone?: CalloutTone;
  density?: CalloutDensity;
  /** stacked：内容纵向排（多个段落/统计块），默认 inline（图标 / 正文 / 动作横排）。 */
  layout?: 'inline' | 'stacked';
  /** inline 布局下图标与正文的纵向对齐；单行文案 + 动作时用 center。 */
  align?: 'start' | 'center';
  /** 左侧状态图标（固定 16px；色调随 tone）。 */
  icon?: LucideIcon;
  /** 右侧常驻动作（如「知道了」「立即导出」）；需要按钮在正文下方时直接放进 children。 */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  const container =
    'flex rounded-lg border ' +
    (layout === 'stacked' ? 'flex-col ' : align === 'center' ? 'items-center ' : 'items-start ') +
    DENSITIES[density] +
    ' ' +
    TONES[tone] +
    (className ? ' ' + className : '');
  return (
    <div className={container} {...rest}>
      {icon && (
        <Icon
          d={icon}
          className={'h-4 w-4 shrink-0 ' + ICON_TONES[tone] + (align === 'start' ? ' mt-0.5' : '')}
        />
      )}
      {layout === 'stacked' ? children : <div className="min-w-0 flex-1">{children}</div>}
      {action}
    </div>
  );
}
