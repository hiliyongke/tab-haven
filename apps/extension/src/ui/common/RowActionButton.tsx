import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/common/Icon';

/**
 * 行内图标按钮（20px 视觉档：列表行 / 卡片头 / 分区头 / 磁贴角标共用）。
 *
 * 收口的缘由：此前这一种形态在 9 个文件里各写一串
 * `<button className="row-action" title={x} aria-label={x}>`，于是
 * 命中下限、危险态入口（.is-danger）、禁用态兜底各写一份 —— 改一处必漏一处
 * （实测 FolderRow 传了 disabled，而 .row-action 根本没写 disabled:hover 回落）。
 *
 * 与 `IconButton` 的分工：IconButton 是 24/32px 的工具条档（可带文字标签与计数
 * 徽章），本组件是 20px 的密集列表档，视觉与命中扩区都走 main.css 的 `.row-action`
 * （::after 把 20px 撑到 24px，WCAG 2.5.8）。
 *
 * 转发 ref 并透传原生属性：dnd-kit 的键盘手柄要把 `ref` 与 `attributes`
 * （role / tabIndex / aria-roledescription）挂到真按钮上。此前 SectionHead 的
 * 手柄因为拿不到这两样而退回手写 `<button className="row-action">` —— 形态一致的
 * 按钮出现两个实现，正是本组件要消灭的重复。
 */
type RowActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'type'
  | 'className'
  | 'title'
  | 'aria-label'
  | 'aria-expanded'
  | 'disabled'
  | 'onClick'
  | 'children'
> & {
  icon?: LucideIcon;
  /**
   * 可访问名：同时落到 `title` 与 `aria-label`（与 IconButton 同口径）。
   * icon-only 按钮没有可见文字，两者缺一就会有一类用户拿不到名字。
   */
  label: string;
  /** 鼠标提示需要比可访问名更长时用它覆盖 title（缺省回落到 label）。 */
  tooltip?: string;
  /** 危险操作：hover / focus 转砖红（走 .row-action.is-danger 统一入口）。 */
  danger?: boolean;
  disabled?: boolean;
  /** 展开态（折叠 / 详情这类 disclosure 按钮的 aria-expanded）。 */
  ariaExpanded?: boolean;
  className?: string;
  /** 图标尺寸与配色类（默认 14px；需要强调色时传 `h-3.5 w-3.5 text-accent-500`）。 */
  iconClass?: string;
  /**
   * 自定义图标节点（如会随展开态旋转的 CollapseChevron）；
   * 传了它就取代 `icon` + `iconClass`。
   */
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const RowActionButton = forwardRef<HTMLButtonElement, RowActionButtonProps>(
  function RowActionButton(
    {
      icon,
      label,
      tooltip,
      danger = false,
      disabled,
      ariaExpanded,
      className,
      iconClass = 'h-3.5 w-3.5',
      children,
      onClick,
      ...rest
    },
    ref
  ) {
    return (
      <button
        {...rest}
        ref={ref}
        type="button"
        className={
          /* disabled:* 两项与 Button / IconButton 同口径（50% 透明度 + 非手型光标）。
             hover 回落写在 main.css 的 .row-action:disabled —— 原生 disabled 按钮
             在 Chrome 里仍匹配 :hover，只在组件侧写类挡不住 CSS 里的变色。 */
          'row-action disabled:cursor-default disabled:opacity-50' +
          (danger ? ' is-danger' : '') +
          (className ? ' ' + className : '')
        }
        title={tooltip ?? label}
        aria-label={label}
        aria-expanded={ariaExpanded}
        disabled={disabled}
        onClick={onClick}
      >
        {children ?? (icon ? <Icon d={icon} className={iconClass} /> : null)}
      </button>
    );
  }
);
