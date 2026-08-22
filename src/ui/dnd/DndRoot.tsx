import { useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { DragType, type DragData } from './types';

/** dnd-kit sensor 配置：必须模块级稳定对象引用。 */
const POINTER_SENSOR_CONFIG = { activationConstraint: { distance: 4 } } as const;

/**
 * 拖拽碰撞检测：优先取指针实际所在的最深层投放目标（解决拖分组头/标签到固定空间时
 * closestCenter 可能误判为最近 section 的问题）；指针不在任何投放目标内时回退最近中心
 * （同列表排序仍按中心距离计算插入位）。
 */
function dragCollisionDetection(args: Parameters<CollisionDetection>[0]): Collision[] {
  const activeData = args.active.data.current as DragData | undefined;
  const activeType = activeData?.type;

  // 卡片层级（分组/文件夹）排序：只与同层级的 droppable 比较中心距离，
  // 忽略内层标签行/条目，避免拖卡片时指针划过 body 误命中某一行导致排序失效。
  if (activeType === DragType.Section || activeType === DragType.Folder) {
    const cardContainers = args.droppableContainers.filter((container) => {
      const type = (container.data.current as { type?: string } | undefined)?.type;
      return (
        type === DragType.Section ||
        type === DragType.Folder ||
        type === 'fixed-area' ||
        type === 'pinned-strip'
      );
    });
    return closestCenter({ ...args, droppableContainers: cardContainers });
  }

  // 磁贴层级（永久固定磁贴）：横向排列，用中心距离判断，避免 pointerWithin 对磁贴间空隙敏感。
  if (activeType === DragType.Pin) {
    const pinContainers = args.droppableContainers.filter((container) => {
      const type = (container.data.current as { type?: string } | undefined)?.type;
      return type === DragType.Pin || type === 'pinned-strip';
    });
    return closestCenter({ ...args, droppableContainers: pinContainers });
  }

  // 行层级（标签/固定条目）：指针精确命中 + 面积最小，
  // 让拖到嵌套目标（folder-item / folder / fixed-area）时命中最深层，而不是误中外层外壳。
  const within = pointerWithin(args);
  if (within.length > 0) {
    const sorted = [...within].sort((a, b) => {
      const rectA = args.droppableRects.get(a.id);
      const rectB = args.droppableRects.get(b.id);
      const areaA = rectA ? rectA.width * rectA.height : 0;
      const areaB = rectB ? rectB.width * rectB.height : 0;
      return areaA - areaB;
    });
    return sorted;
  }
  return closestCenter(args);
}

/** 根据拖拽数据生成 DragOverlay 的轻量跟随内容。 */
function buildDragOverlay(data: DragData): ReactNode {
  switch (data.type) {
    case DragType.Tab:
    case DragType.FolderItem:
      return (
        <div className="drag-overlay-chip">
          <Favicon src={data.favIconUrl} title={data.title || ''} size={16} />
          <span className="truncate">{data.title}</span>
        </div>
      );
    case DragType.Section:
      return (
        <div className="drag-overlay-chip">
          <Icon d={Icons.grip} className="h-3.5 w-3.5" />
          <span className="truncate">{data.title}</span>
        </div>
      );
    case DragType.Pin:
      return (
        <div className="drag-overlay-chip">
          <Favicon src={data.favIconUrl} title={data.title || ''} size={16} />
        </div>
      );
    case DragType.Folder:
      return (
        <div className="drag-overlay-chip">
          <Icon d={Icons.folder} className="h-3.5 w-3.5" />
          <span className="truncate">{data.name}</span>
        </div>
      );
  }
}

/**
 * 全局拖拽根：整个侧边栏共享一个 DndContext + DragOverlay。
 * - 列表内排序：各列表的 SortableContext 直接挂在下面；
 * - 跨容器投放（标签/分组 → 固定空间）：用 useDroppable，由 App 层 onDragEnd 分派；
 * - DragOverlay 提供跟随指针的丝滑拖拽视觉，替代原生 HTML5 DnD 的系统 ghost。
 */
export function DndRoot({
  children,
  onDragEnd
}: {
  children: ReactNode;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_CONFIG));
  const [overlay, setOverlay] = useState<ReactNode | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (!data) return;
    setOverlay(buildDragOverlay(data));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setOverlay(null);
    onDragEnd(event);
  };
  const handleDragCancel = () => setOverlay(null);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dragCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={(event: DragCancelEvent) => {
        void event;
        handleDragCancel();
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
    </DndContext>
  );
}
