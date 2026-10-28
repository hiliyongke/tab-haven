import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/common/Icon';

/**
 * 统一图标按钮（工具条/弹窗/头部共用）。
 * 统一图标按钮样式，业务代码不写原子类：
 * 统一 label/tooltip、disabled、激活态、危险态与计数徽章。
 *
 * 可访问名口径与 `RowActionButton` / `Button` 同源：`label` 落到 `aria-label`，
 * `title` 由 `tooltip ?? label` 派生 —— 只有 tooltip 没有 label 时，读屏会拿到
 * 一个无名按钮（icon-only 按钮没有可见文字可兜底）。
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
  /**
   * 右上角计数徽章（>0 时显示）。
   *
   * 非通用语义（工具条专用），待专用组件承接：去掉会让底栏「有 3 处重复 /
   * 7 份快照」这类信息失去视觉载体，故先保留而不是为纯洁牺牲功能。
   */
  badge?: number;
  /**
   * 可选文字标签（text-3xs），与图标横排；不传则纯图标。
   * 窄面板由 CSS 统一隐藏文字（不再区分核心入口：保留三个入口的文字会把底栏
   * 挤到换行，窄档一律退回纯图标，语义由 label 承载）。
   */
  text?: string;
  /**
   * 关闭类按钮（弹窗右上角 ✕）：渲染 `data-dialog-dismiss` 标记。
   * 弹窗打开时「聚焦首项」会跳过带该标记的元素 —— 否则焦点一打开就落在关闭
   * 按钮上，而不是输入框或主按钮（Tab 循环仍会经过它，可达性不变）。
   *
   * 非通用语义（属弹窗首焦逻辑），待专用组件承接。
   */
  dismiss?: boolean;
  /** 附加类（末尾拼接，与 Button 同口径）。 */
  className?: string;
  onClick?: () => void;
}) {
  const resolvedSize = size;
  // 尺寸兜底：min-h/min-w 保证命中区不小于 24px（WCAG 2.5.8）。
  // 单靠 p-1 + h-4 图标刚好 24px，一旦调用方传入更小的 iconClass（如 h-3.5）就会掉到 22px。
  // 禁用态透明度与 Button 统一为 50（原 35 过淡，几乎看不出是个控件）。
  const classes =
    /* cursor-pointer 与 Button 基类统一（Tailwind v4 preflight 不再默认提供） */
    /* disabled:hover:* 与 Button 同口径：原生 disabled 按钮在 Chrome 里仍匹配 :hover */
    'relative inline-flex items-center justify-center gap-1 rounded transition-base cursor-pointer hover:bg-gray-100 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ' +
    /* 两档与 Button 同刻度（24 / 32）。原 md 是 min-h-7(28px) + p-1.5(6px)：
       28 不在刻度上、6 脱网格，且同排混用 sm/md 时高差 4px 造成重心偏移。 */
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
      // 角标是 aria-hidden 的纯数字，必须把数量并进可访问名：
      // 否则读屏用户拿不到「有 7 份快照 / 3 处重复」这类信息
      // （逐个入口手动拼数量会造成三处口径不一致）。
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
