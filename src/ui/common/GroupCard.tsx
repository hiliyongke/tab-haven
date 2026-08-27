import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useDndContext } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SectionHead } from '@/ui/common/SectionHead';
import { DragType, type DragData } from '@/ui/dnd/types';

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
  const sortable = useSortable({ id, data: dragData, disabled });
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
  // 仅「跨容器投放」（拖标签/分组到本卡片）显示整卡投放高亮；
  // 同层排序时的 isOver 只参与落点判断，不触发盒子高亮，避免排序路径上卡片乱闪。
  const { active } = useDndContext();
  const activeType = (active?.data.current as DragData | undefined)?.type;
  // 拖标签/分组/固定条目到本卡片时高亮投放反馈（固定条目 → 文件夹为跨文件夹移动，→ 分组为移出固定空间）。
  const receivingDrop =
    activeType === DragType.Tab ||
    activeType === DragType.Section ||
    activeType === DragType.FolderItem;
  const cardClass =
    'section-card' +
    (accent ? ' is-accented' : '') +
    (sortable.isDragging ? ' is-sorting' : '') +
    (receivingDrop && sortable.isOver ? ' is-drop-target' : '') +
    (className ? ' ' + className : '');
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    ...(accent ? ({ '--accent': accent } as CSSProperties) : {})
  };
  return (
    <section ref={sortable.setNodeRef} className={cardClass} style={style}>
      <SectionHead
        icon={icon}
        accent={accent}
        title={title}
        count={count}
        onToggle={onToggle}
        expanded={onToggle ? !collapsed : undefined}
        onClose={onClose}
        closeTitle={closeTitle}
        mediaIndicator={mediaIndicator}
        action={action}
        dragHandleProps={disabled ? undefined : headPointerListeners}
        dragKeyboard={dragKeyboard}
      />
      {!collapsed && children}
    </section>
  );
}
