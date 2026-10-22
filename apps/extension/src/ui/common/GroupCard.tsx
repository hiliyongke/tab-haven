import {
  useId,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react';
import { useDndContext } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SectionHead } from '@/ui/common/SectionHead';
import { classifyDrop, dropFeedbackClass } from '@/ui/dnd/dropPolicy';
import type { DragData } from '@/ui/dnd/types';

/**
 * 通用分组卡片壳（原生组 / 站点组 / 固定文件夹 / 未分组 / 浏览器置顶 共用）：
 *  - sortable 头部（dnd-kit useSortable）承担同容器排序 + 跨容器投放；
 *  - 视觉完全复用 SectionHead；
 *  - body 通过 children 注入，调用方决定内容（RowList / FolderItemRow list / pinned-grid 等）。
 */
export function GroupCard({
  id,
  dragData,
  disabled,
  title,
  count,
  accent,
  icon,
  mediaIndicator,
  action,
  onToggle,
  onClose,
  closeTitle,
  collapsed,
  className,
  children
}: {
  id: string | number;
  dragData: DragData;
  /** 禁用 sortable（未分组 / 浏览器置顶等不参与排序的场景）。 */
  disabled?: boolean;
  title: string;
  count: number;
  accent?: string;
  icon?: ReactNode;
  mediaIndicator?: ReactNode;
  action?: ReactNode;
  onToggle?: () => void;
  onClose?: () => void;
  closeTitle?: string;
  collapsed?: boolean;
  /** 附加在 section-card 上的额外 class（如浏览器置顶 is-pinned）。 */
  className?: string;
  children?: ReactNode;
}) {
  // transition: null —— 同 TabRow：关掉让位过渡，避免动画期间矩形漂移导致落点不准。
  const sortable = useSortable({ id, data: dragData, disabled, transition: null });
  // 指针拖拽挂整个头部（整头可拖），键盘拖拽挂专用手柄（KeyboardSensor 要求 keydown
  // 目标即 activator；手柄是真实 button，不与头部内 toggle 按钮的 Space/Enter 冲突）。
  const { onKeyDown: headKeyDown, ...headPointerListeners } = sortable.listeners ?? {};
  const dragKeyboard = disabled
    ? undefined
    : {
        attributes: { ...sortable.attributes } as Record<string, unknown>,
        listeners: headKeyDown
          ? { onKeyDown: headKeyDown as (event: ReactKeyboardEvent<HTMLButtonElement>) => void }
          : undefined,
        activatorRef: sortable.setActivatorNodeRef
      };
  // 落点反馈与松手执行共用同一份判定（ui/dnd/dropPolicy）：
  // 亮起即代表松手真的会做事，禁用态即代表放不进去，不存在第三种结局。
  const { active } = useDndContext();
  const activeData = active?.data.current as DragData | undefined;
  const outcome = activeData ? classifyDrop(activeData, { id, data: dragData }) : undefined;
  const cardClass =
    'section-card' +
    (accent ? ' is-accented' : '') +
    (sortable.isDragging ? ' is-sorting' : '') +
    dropFeedbackClass(sortable.isOver, outcome) +
    (className ? ' ' + className : '');
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    ...(accent ? ({ '--accent': accent } as CSSProperties) : {})
  };
  // 折叠体 id：给 SectionHead 的 aria-controls 用（aria-expanded 只有配了 controls
  // 才能让读屏把开关与被折叠的内容关联起来）。
  const panelId = useId();
  return (
    <section ref={sortable.setNodeRef} className={cardClass} style={style}>
      <SectionHead
        icon={icon}
        accent={accent}
        title={title}
        count={count}
        onToggle={onToggle}
        expanded={onToggle ? !collapsed : undefined}
        panelId={panelId}
        onClose={onClose}
        closeTitle={closeTitle}
        mediaIndicator={mediaIndicator}
        action={action}
        dragHandleProps={disabled ? undefined : headPointerListeners}
        dragKeyboard={dragKeyboard}
      />
      {/* id 与 SectionHead 的 aria-controls 对应；折叠时不渲染，controls 指向的
          目标随之消失是 ARIA 允许的（配合 aria-expanded=false 语义一致）。 */}
      {!collapsed && <div id={panelId}>{children}</div>}
    </section>
  );
}
