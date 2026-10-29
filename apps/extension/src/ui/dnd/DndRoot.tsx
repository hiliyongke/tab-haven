import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Translate } from 'i18n-kit';
import { useTranslation } from '@/i18n';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Over,
  type ScreenReaderInstructions
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KeyboardCode } from '@dnd-kit/core';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { classifyDrop } from './dropPolicy';
import {
  DragType,
  FIXED_AREA_DROPPABLE,
  PINNED_STRIP_DROPPABLE,
  type DragData,
  type DropTargetData
} from './types';

/** dnd-kit sensor 配置：必须模块级稳定对象引用。 */
const POINTER_SENSOR_CONFIG = { activationConstraint: { distance: 4 } } as const;
/**
 * KeyboardSensor：Space 抓取 + 方向键移动 + Space 放置。keyboardCodes 刻意排除 Enter：
 * 行主按钮既是键盘拖拽 activator 又是激活/打开按钮，Enter 若被拖拽拦截（preventDefault
 * 吞掉合成 click），键盘用户将无法用 Enter 激活标签。保留 Space 拖拽，Enter 交还点击。
 */
const KEYBOARD_SENSOR_CONFIG = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: {
    start: [KeyboardCode.Space],
    cancel: [KeyboardCode.Esc],
    end: [KeyboardCode.Space]
  }
};

/**
 * 投放目标测量：拖拽期间持续重测（Always）。默认 WhileDragging 只测一次，而排序时其余行
 * 因让位 transform 持续位移，旧矩形与实际位置错位导致落点飘；Always 让矩形跟随真实布局。
 * 代价是每帧重测，但侧边栏行数有限（超 200 行的分区已虚拟化、不参与排序）。
 */
const DROPPABLE_MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always }
} as const;

/**
 * 关闭拖拽自动滚动：默认在容器上下 20% 触发滚动，触发带恰好罩住列表首末两行，
 * 拖到最前/最后时指针必进入该区域导致持续滚动、落点漂移。同屏拖拽无需滚动；
 * 跨屏移动改用 Alt+↑/↓ 键盘重排。
 */
const AUTO_SCROLL_CONFIG = { enabled: false } as const;

/**
 * 拖拽碰撞检测：优先取指针实际所在的最深层投放目标（避免拖分组头/标签到固定空间时
 * closestCenter 误判为最近 section）；指针不在任何目标内时回退最近中心（同列表排序
 * 仍按中心距离算插入位）。导出供测试直接驱动：它藏在 DndContext 内部无法从外部触发。
 */
export function dragCollisionDetection(args: Parameters<CollisionDetection>[0]): Collision[] {
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
        type === FIXED_AREA_DROPPABLE ||
        type === PINNED_STRIP_DROPPABLE
      );
    });
    return closestCenter({ ...args, droppableContainers: cardContainers });
  }

  // 磁贴层级：横向排列用中心距离判断，避免 pointerWithin 对磁贴间空隙敏感。
  // 只在指针仍处于磁贴区内才这样判定，一旦离开必须放行到行层级，否则「拖回标签区
  // 取消固定」「拖到收藏夹」永远无落点可命中。放行时只认指针精确命中、不做 closestCenter
  // 兜底：离开动作有副作用，用「最近的行」去接会让指针滑到空白时凭空取消固定。
  if (activeType === DragType.Pin) {
    const pinContainers = args.droppableContainers.filter((container) => {
      const type = (container.data.current as { type?: string } | undefined)?.type;
      return type === DragType.Pin || type === PINNED_STRIP_DROPPABLE;
    });
    const withinPins = pointerWithin({ ...args, droppableContainers: pinContainers });
    if (withinPins.length > 0) {
      return closestCenter({ ...args, droppableContainers: pinContainers });
    }
    return pointerWithin(args);
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
  // 指针落在列表空白/边界外：只在「同级且同容器」的行目标里取最近中心。两层限定缺一不可：
  // 不限定层级，外层容器面积大、中心更贴近指针会截胡成「拖入固定空间」；
  // 不限定容器，相邻分区的行会被跨列表命中（指针略偏就落到隔壁分区）。
  const activeContainer = activeData?.type === DragType.Tab ? activeData.containerKey : undefined;
  const rowContainers = args.droppableContainers.filter((container) => {
    const data = container.data.current as DragData | undefined;
    if (!data) return false;
    if (data.type === DragType.Tab) {
      return activeContainer === undefined || data.containerKey === activeContainer;
    }
    return data.type === DragType.FolderItem;
  });
  if (rowContainers.length > 0) {
    return closestCenter({ ...args, droppableContainers: rowContainers });
  }
  // 同容器无候选（跨容器拖拽且指针落在空白）时仅匹配行级目标，避免列表外指针命中 fixed-area / pinned-strip。
  const anyRow = args.droppableContainers.filter((container) => {
    const data = container.data.current as DragData | undefined;
    return data?.type === DragType.Tab || data?.type === DragType.FolderItem;
  });
  return closestCenter({ ...args, droppableContainers: anyRow });
}

/** 拖拽元素的可播报名称：分组/标签用 title，文件夹用 name，纯投放区无名称。 */
function dragLabel(data: DropTargetData | undefined): string {
  if (!data) return '';
  if ('title' in data) return data.title;
  return 'name' in data ? data.name : '';
}

/**
 * 构建读屏播报配置（导出供测试驱动）：dnd-kit 内置指令与公告是英文，这里注入 i18n 文案。
 * 播报与落点反馈同源：命中结构性不可投放位置时播报「该位置不能放置」，而非先说「移动到 X」
 * 松手后无事发生——读屏用户看不到禁用态，语言是唯一信息来源。
 */
export function buildDragAccessibility(t: Translate): {
  screenReaderInstructions: ScreenReaderInstructions;
  announcements: Announcements;
} {
  /** 当前落点是否被结构性拒绝（设置闸门不参与：那是全局状态，播报里不反复念）。 */
  const rejected = (active: { data: { current?: unknown } }, over: Over | null): boolean => {
    if (!over) return false;
    const activeData = active.data.current as DragData | undefined;
    if (!activeData) return false;
    return (
      classifyDrop(activeData, {
        id: over.id,
        data: over.data.current as DropTargetData | undefined
      }).kind === 'reject'
    );
  };

  return {
    screenReaderInstructions: {
      draggable: t('按空格键开始拖拽，用方向键移动，再次按空格键放置，按 Esc 取消')
    },
    announcements: {
      onDragStart: ({ active }) =>
        t('已抓取 {{title}}', { title: dragLabel(active.data.current as DragData | undefined) }),
      onDragOver: ({ active, over }) => {
        if (!over) return undefined;
        if (rejected(active, over)) return t('该位置不能放置');
        return t('移动到 {{title}}', {
          title: dragLabel(over.data.current as DragData | undefined)
        });
      },
      onDragEnd: ({ active, over }) => {
        if (!over) return t('已放置回原位');
        if (rejected(active, over)) return t('该位置不能放置');
        return t('已放置 {{title}}', {
          title: dragLabel(over.data.current as DragData | undefined)
        });
      },
      onDragCancel: () => t('已取消拖拽')
    }
  };
}

/** 根据拖拽数据生成 DragOverlay 的轻量跟随内容（导出理由同 dragCollisionDetection）。 */
export function buildDragOverlay(data: DragData): ReactNode {
  switch (data.type) {
    case DragType.Tab:
    case DragType.FolderItem:
      return (
        <div className="drag-overlay-chip">
          <Favicon pageUrl={data.url} title={data.title || ''} size={16} />
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
          <Favicon pageUrl={data.url} title={data.title || ''} size={16} />
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
 * 标记「刚放下」：松手时指针仍停在落点行，标记暂时隐藏 :hover 把手，并在指针移动时自动清除。
 */
/** 挂起的「刚放下」清理器；键盘拖拽不产生 pointermove，因此新标记前先清理旧监听器。 */
let pendingJustDroppedClear: (() => void) | null = null;

/** 导出供测试验证拖拽标记及其监听器清理契约。 */
export function markJustDropped(): void {
  pendingJustDroppedClear?.();
  document.body.classList.add('dnd-just-dropped');
  const clear = () => {
    document.body.classList.remove('dnd-just-dropped');
    window.removeEventListener('pointermove', clear);
    if (pendingJustDroppedClear === clear) pendingJustDroppedClear = null;
  };
  pendingJustDroppedClear = clear;
  window.addEventListener('pointermove', clear, { once: true });
}

/**
 * 全局拖拽根：整个侧边栏共享一个 DndContext + DragOverlay。
 * - 列表内排序：各列表的 SortableContext 直接挂在下面；
 * - 跨容器投放（标签/分组 → 固定空间）：用 useDroppable，由 App 层 onDragEnd 分派；
 * - DragOverlay 提供跟随指针移动的拖拽内容。
 */
export function DndRoot({
  children,
  onDragEnd
}: {
  children: ReactNode;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_CONFIG),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_CONFIG)
  );
  const [overlay, setOverlay] = useState<ReactNode | null>(null);
  const { t } = useTranslation();

  /** 读屏播报本地化（构建逻辑见 buildDragAccessibility，导出供测试驱动）。 */
  const accessibility = useMemo(() => buildDragAccessibility(t), [t]);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (!data) return;
    setOverlay(buildDragOverlay(data));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setOverlay(null);
    // 指针仍在松手行上时暂时隐藏把手，直到指针再次移动。
    markJustDropped();
    onDragEnd(event);
  };
  const handleDragCancel = () => setOverlay(null);

  // 拖拽期间给 body 打标记，按 main.css 的 body.dnd-dragging 规则收起行尾操作，避免布局变化影响落点。
  useEffect(() => {
    if (overlay === null) return;
    document.body.classList.add('dnd-dragging');
    return () => {
      document.body.classList.remove('dnd-dragging');
    };
  }, [overlay]);

  return (
    <DndContext
      sensors={sensors}
      accessibility={accessibility}
      collisionDetection={dragCollisionDetection}
      measuring={DROPPABLE_MEASURING}
      autoScroll={AUTO_SCROLL_CONFIG}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => handleDragCancel()}
    >
      {children}
      {/* DragOverlay 用 position: fixed 跟随指针，而 .app 带 container-type
          （layout containment）已成为 fixed 后代的包含块；.app 加了 overflow: hidden
          兜底布局后，留在内部的 overlay 会在面板边缘被裁掉半截。Portal 到 body 后
          定位回到视口，与 Dialog/ContextMenu 同一处理。 */}
      {createPortal(<DragOverlay dropAnimation={null}>{overlay}</DragOverlay>, document.body)}
      {/* 拖拽期提示：碰撞检测三级回退永不返回空，移动 4px 松手就一定落到某个
          有效目标上（排序 / 加进文件夹 / 甚至新建文件夹）。必须把 Esc 可取消
          明示出来 —— 否则误拖必然被当成一次真实变更。 */}
      {overlay !== null &&
        createPortal(
          <div className="dnd-hint" role="status">
            {t('松开以放置 · Esc 取消')}
          </div>,
          document.body
        )}
    </DndContext>
  );
}
