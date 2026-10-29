import { useId, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { SectionHead } from '@/ui/common/SectionHead';
import { dropFeedbackClass, type DropOutcome } from '@/ui/dnd/dropPolicy';

/**
 * 分区外壳：`section-card` 的 class 组合、`SectionHead`、折叠闸门与落点反馈
 * 的唯一出口。
 *
 * 两种接线形态都是本组件的薄壳：
 * - `GroupCard` 注入 `useSortable` 的 ref / transform / listeners；
 * - `CategoryModule` 注入 droppable 的 ref / isOver / outcome。
 * 分区视觉只有这一处可改。
 */
export function SectionShell({
  title,
  count,
  countLabel,
  accent,
  icon,
  action,
  mediaIndicator,
  onToggle,
  toggleTitle,
  onClose,
  closeTitle,
  dragHandleProps,
  dragKeyboard,
  collapsed,
  isSorting = false,
  setNodeRef,
  isOver,
  outcome,
  transform,
  transition,
  ariaLabel,
  className,
  children
}: {
  title: string;
  count: number;
  /** 计数量纲（读屏播报），语义见 SectionHead。 */
  countLabel?: string;
  accent?: string;
  icon?: ReactNode;
  action?: ReactNode;
  mediaIndicator?: ReactNode;
  onToggle?: () => void;
  toggleTitle?: string;
  onClose?: () => void;
  closeTitle?: string;
  dragHandleProps?: Record<string, unknown>;
  dragKeyboard?: {
    attributes: Record<string, unknown>;
    listeners?: { onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void };
    activatorRef: (node: HTMLElement | null) => void;
  };
  /** 折叠态；不传 = 不可折叠（模块壳），body 始终渲染。 */
  collapsed?: boolean;
  /** 拖拽排序中：整卡浮起。 */
  isSorting?: boolean;
  setNodeRef?: (node: HTMLElement | null) => void;
  isOver?: boolean;
  outcome?: DropOutcome;
  /** dnd-kit 的排序位移与过渡（仅可排序分区传入）。 */
  transform?: CSSProperties['transform'];
  transition?: string;
  /** 模块级可访问名（如「收藏夹」）。 */
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  const panelId = useId();
  const style: CSSProperties = {
    ...(transform ? { transform } : {}),
    ...(transition ? { transition } : {}),
    /* 分区强调色：SectionHead 的色条用它，.is-accented 的计数染色也读它。 */
    ...(accent ? ({ '--accent': accent } as CSSProperties) : {})
  };
  const cardClass =
    'section-card' +
    (accent ? ' is-accented' : '') +
    (isSorting ? ' is-sorting' : '') +
    dropFeedbackClass(isOver ?? false, outcome) +
    (className ? ' ' + className : '');

  return (
    <section
      ref={setNodeRef}
      aria-label={ariaLabel}
      className={cardClass}
      style={Object.keys(style).length > 0 ? style : undefined}
    >
      <SectionHead
        icon={icon}
        accent={accent}
        title={title}
        count={count}
        countLabel={countLabel}
        onToggle={onToggle}
        toggleTitle={toggleTitle}
        expanded={onToggle ? !collapsed : undefined}
        panelId={onToggle ? panelId : undefined}
        onClose={onClose}
        closeTitle={closeTitle}
        mediaIndicator={mediaIndicator}
        action={action}
        dragHandleProps={dragHandleProps}
        dragKeyboard={dragKeyboard}
      />
      {/* 只有可折叠分区才包 body 容器：panelId 要供 SectionHead 的 aria-controls 使用。
          模块壳（无 onToggle）直接渲染 children，使模块内的第一张分区卡命中
          `.section-card:first-child` 并隐藏顶部分隔线。 */}
      {onToggle ? !collapsed && <div id={panelId}>{children}</div> : children}
    </section>
  );
}
