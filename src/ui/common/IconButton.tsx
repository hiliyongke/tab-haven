import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/common/Icon';

/**
 * 统一图标按钮（工具条/弹窗/头部共用）。
 * 统一图标按钮样式，业务代码不写原子类：
 * 统一 title/aria-label、disabled、激活态、危险态与计数徽章。
 */
export function IconButton({
  icon,
  title,
  iconClass = 'h-4 w-4',
  box = 'sm',
  tone = 'default',
  disabled,
  isOn,
  danger,
  badge,
  onClick,
  /** 可选文字标签：传入后在图标右侧显示功能名称（工具条可选文字模式）。 */
  label
}: {
  icon: LucideIcon;
  /** tooltip + aria-label（icon-only 按钮的可达性必须项）。 */
  title: string;
  /** 可选文字标签（text-3xs），与图标横排；不传则纯图标。 */
  label?: string;
  /** 图标尺寸类（默认 16px）。 */
  iconClass?: string;
  /** 按钮盒子大小：sm = p-1（16px 图标），md = p-1.5。 */
  box?: 'sm' | 'md';
  /** 默认灰字；accent = 灰字 + hover 品牌绿（设置入口等）。 */
  tone?: 'default' | 'accent';
  disabled?: boolean;
  /** 激活态（如 pin 已固定、开关已开）。 */
  isOn?: boolean;
  /** 危险操作：hover 转砖红。 */
  danger?: boolean;
  /** 右上角计数徽章（>0 时显示）。 */
  badge?: number;
  onClick?: () => void;
}) {
  // 尺寸兜底：min-h/min-w 保证命中区不小于 24px（WCAG 2.5.8）。
  // 单靠 p-1 + h-4 图标刚好 24px，一旦调用方传入更小的 iconClass（如 h-3.5）就会掉到 22px。
  // 禁用态透明度与 Button 统一为 50（原 35 过淡，几乎看不出是个控件）。
  const className =
    'relative inline-flex items-center justify-center gap-1 rounded transition-base hover:bg-gray-100 disabled:cursor-default disabled:opacity-50 ' +
    (box === 'md' ? 'min-h-7 min-w-7 p-1.5' : 'min-h-6 min-w-6 p-1') +
    (tone === 'accent' ? ' text-gray-600 hover:text-accent-600' : '') +
    (isOn ? ' bg-accent-50 text-accent-600 hover:bg-accent-100' : '') +
    (danger ? ' hover:bg-red-50 hover:text-red-600' : '');
  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={title}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon d={icon} className={iconClass} />
      {label && <span className="icon-btn-label text-3xs leading-none">{label}</span>}
      {badge !== undefined && badge > 0 && (
        <span className="count-badge absolute -right-1 -top-1" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}
