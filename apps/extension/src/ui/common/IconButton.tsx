import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/common/Icon';

/**
 * 统一图标按钮（工具条/弹窗/头部共用）：收口 label/tooltip、disabled、激活态、危险态与计数徽章，
 * 业务代码不写原子类。可访问名同 RowActionButton/Button：label 落 aria-label、title 由
 * `tooltip ?? label` 派生 —— icon-only 按钮没有可见文字，缺 label 会让读屏拿到无名按钮。
 */
export function IconButton({
  icon,
  label,
  tooltip,
  iconClass = 'h-4 w-4',
  size = 'sm',
  tone = 'default',
  disabled,
  isOn,
  danger,
  badge,
  onClick,
  /** 可选文字标签：传入后在图标右侧显示功能名称（底栏可选文字模式）。 */
  text,
  dismiss,
  className
}: {
  icon: LucideIcon;
  /** 可访问名（必填）：落到 aria-label，缺省同时承担 title。 */
  label: string;
  /** 鼠标提示需要比可访问名更长时用它覆盖 title（缺省回落到 label）。 */
  tooltip?: string;
  /** 图标尺寸类（默认 16px）。 */
  iconClass?: string;
  /** 按钮盒子大小：sm = p-1（16px 图标），md = p-1.5。 */
  size?: 'sm' | 'md';
  /** 默认灰字；accent = 灰字 + hover 品牌绿（设置入口等）。 */
  tone?: 'default' | 'accent';
  disabled?: boolean;
  /** 激活态（如 pin 已固定、开关已开）。 */
  isOn?: boolean;
  /** 危险操作：hover 转砖红。 */
  danger?: boolean;
  /** 右上角计数徽章（>0 时显示），工具条专用；去掉会让底栏「有 N 处重复/快照」失去视觉载体。 */
  badge?: number;
  /** 可选文字标签（text-3xs），与图标横排；不传则纯图标。窄面板由 CSS 统一隐藏文字。 */
  text?: string;
  /** 关闭类按钮（弹窗右上角 ✕）：渲染 `data-dialog-dismiss` 标记，弹窗「聚焦首项」会跳过它
   *  （否则焦点一打开就落在关闭按钮上）；Tab 循环仍经过它，可达性不变。 */
  dismiss?: boolean;
  /** 附加类（末尾拼接，与 Button 同口径）。 */
  className?: string;
  onClick?: () => void;
}) {
  const resolvedSize = size;
  // min-h/min-w 兜底命中区 ≥24px（WCAG 2.5.8）：p-1 + h-4 图标刚好 24px，传入更小
  // iconClass 会掉到 22px。禁用态透明度与 Button 统一为 50。
  const classes =
    /* Tailwind v4 preflight 不为按钮设置手型光标，交互态由组件显式提供。 */
    /* disabled:hover:* 与 Button 同口径：原生 disabled 按钮在 Chrome 里仍匹配 :hover */
    'relative inline-flex items-center justify-center gap-1 rounded transition-base cursor-pointer hover:bg-gray-100 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ' +
    /* 两档与 Button 同刻度（24 / 32）。 */
    (resolvedSize === 'md' ? 'min-h-8 min-w-8 p-2' : 'min-h-6 min-w-6 p-1') +
    (tone === 'accent' ? ' text-gray-600 hover:text-accent-600 disabled:hover:text-gray-600' : '') +
    (isOn ? ' bg-accent-50 text-accent-600 hover:bg-accent-100 disabled:hover:bg-accent-50' : '') +
    (danger
      ? ' hover:bg-red-50 hover:text-red-600 disabled:hover:bg-transparent disabled:hover:text-gray-600'
      : '') +
    (className ? ' ' + className : '');
  return (
    <button
      type="button"
      className={classes}
      title={tooltip ?? label}
      // 角标是 aria-hidden 的纯数字，必须把数量并进可访问名，否则读屏拿不到
      // 「有 7 份快照 / 3 处重复」这类信息。
      aria-label={badge !== undefined && badge > 0 ? `${label}（${badge}）` : label}
      data-dialog-dismiss={dismiss || undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon d={icon} className={iconClass} />
      {text && <span className="icon-btn-label text-3xs leading-none">{text}</span>}
      {badge !== undefined && badge > 0 && (
        <span className="count-badge absolute -right-1 -top-1" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}
