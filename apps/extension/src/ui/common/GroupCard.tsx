import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useDndContext } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SectionShell } from '@/ui/common/SectionShell';
import { classifyDrop } from '@/ui/dnd/dropPolicy';
import type { DragData } from '@/ui/dnd/types';

/**
 * 通用分组卡片壳（原生组 / 站点组 / 固定文件夹 / 未分组 / 浏览器置顶 共用）：
 *  - sortable 头部（dnd-kit useSortable）承担同容器排序 + 跨容器投放；
 *  - 视觉完全复用 SectionShell（section-card + SectionHead）；
 *  - body 通过 children 注入，调用方决定内容（RowList / FolderItemRow list / pinned-grid 等）。
 *
 * 本组件只负责 dnd-kit 的接线：class 组合、折叠闸门与落点反馈都在 SectionShell，
 * 与不可排序的模块壳（CategoryModule）共用同一套分区视觉。
 */
export function GroupCard({
  id,
  dragData,
  disabled,
  title,
  count,
  countLabel,
  accent,
  icon,
  mediaIndicator,
  action,
  onToggle,
  toggleTitle,
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
  countLabel?: string;
  accent?: string;
  icon?: ReactNode;
  mediaIndicator?: ReactNode;
  action?: ReactNode;
  onToggle?: () => void;
  toggleTitle?: string;
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

  return (
    <SectionShell
      title={title}
      count={count}
      countLabel={countLabel}
      accent={accent}
      icon={icon}
      mediaIndicator={mediaIndicator}
      action={action}
      onToggle={onToggle}
      toggleTitle={toggleTitle}
      onClose={onClose}
      closeTitle={closeTitle}
      collapsed={collapsed}
      className={className}
      setNodeRef={sortable.setNodeRef}
      isSorting={sortable.isDragging}
      isOver={sortable.isOver}
      outcome={outcome}
      dragHandleProps={disabled ? undefined : headPointerListeners}
      dragKeyboard={dragKeyboard}
      transform={CSS.Transform.toString(sortable.transform)}
      transition={sortable.transition ?? undefined}
    >
      {children}
    </SectionShell>
  );
}
