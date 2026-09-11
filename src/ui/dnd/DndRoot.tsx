import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
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
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KeyboardCode } from '@dnd-kit/core';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { DragType, type DragData } from './types';

/** dnd-kit sensor 配置：必须模块级稳定对象引用。 */
const POINTER_SENSOR_CONFIG = { activationConstraint: { distance: 4 } } as const;
/**
 * KeyboardSensor：焦点落在拖拽 activator 上时，Space 抓取 + 方向键移动 + Space 放置。
 * keyboardCodes 刻意排除 Enter：KeyboardSensor 默认把 Space/Enter 都当抓取键，而
 * 行主按钮（标签行/固定条目行）既是键盘拖拽 activator 又是激活/打开按钮 —— Enter
 * 若被拖拽拦截（keydown preventDefault 吞掉合成 click），键盘用户将永远无法用 Enter
 * 激活标签或打开条目。保留 Space 完成拖拽语义，Enter 交还给按钮的点击行为。
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
 * 投放目标测量：拖拽期间持续重测。
 *
 * 默认 WhileDragging 只在拖拽开始测一次，而排序时其余行会因让位 transform 持续位移
 * （transition 期间位置一直在变），旧矩形与实际位置错位 —— 表现为「落点飘、
 * 要停一会儿才命中、指针得偏一点才成」。Always 让矩形始终跟随真实布局。
 * 代价是拖拽期间每帧重测，但侧边栏行数有限（超 200 行的分区已走虚拟化、不参与排序），
 * 不构成性能问题。
 */
const DROPPABLE_MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always }
} as const;

/**
 * 关闭拖拽自动滚动。
 *
 * 默认在容器上下 20% 触发滚动：侧边栏可见区 400–600px 时触发带达 80–120px，
 * 恰好罩住列表的首两行与末两行。要把标签拖到最前/最后，指针必然进入该区域，
 * 列表随即持续滚动、落点漂移 —— 正是「首尾位置要试很多次才成功」的成因。
 * 同屏拖拽本就无需滚动；跨屏移动改用 Alt+↑/↓ 键盘重排。
 */
const AUTO_SCROLL_CONFIG = { enabled: false } as const;

/**
 * 拖拽碰撞检测：优先取指针实际所在的最深层投放目标（解决拖分组头/标签到固定空间时
 * closestCenter 可能误判为最近 section 的问题）；指针不在任何投放目标内时回退最近中心
 * （同列表排序仍按中心距离计算插入位）。
 *
 * 导出供测试直接驱动：这是纯函数式的落点判定，决定了「拖到哪算哪」，
 * 但它藏在 DndContext 内部、无法从组件外部触发，不导出就没有任何回归保护。
 * 拖拽是本应用最核心的交互，落点算错是最容易被用户感知为「坏了」的问题。
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
  // 指针落在列表空白/边界外：只在「同级且同容器」的行目标里取最近中心。
  // 两层限定缺一不可：
  //  - 不限定层级，外层容器（fixed-area / pinned-strip）面积大、中心更贴近指针，
  //    会把拖放截胡成「拖入固定空间」；
  //  - 不限定容器，相邻分区的行会被跨列表命中（未分组区首行紧挨上一个站点组，
  //    指针略偏上就落到隔壁分区），表现为「某分区的首尾拖不动」。
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
  // 同容器无候选（跨容器拖拽且指针落在空白）：退到全部行级目标。
  // 到此为止，不再退回全部 droppable —— 那会让指针落在列表之外时
  // 被外层容器（fixed-area / pinned-strip）截胡，凭空变成「拖入固定空间」。
  const anyRow = args.droppableContainers.filter((container) => {
    const data = container.data.current as DragData | undefined;
    return data?.type === DragType.Tab || data?.type === DragType.FolderItem;
  });
  return closestCenter({ ...args, droppableContainers: anyRow });
}

/** 拖拽元素的可播报名称：分组/标签用 title，文件夹用 name。 */
function dragLabel(data: DragData | undefined): string {
  if (!data) return '';
  if ('title' in data) return data.title;
  return 'name' in data ? data.name : '';
}

/**
 * 构建读屏播报配置（导出供测试驱动）。
 *
 * dnd-kit 内置指令与公告是英文，中文界面下读屏用户会听到与界面语言不一致的
 * 提示。这里注入 i18n 文案（指令 + 抓取/移动/放置/取消）。
 * 导出理由同 dragCollisionDetection：这些回调藏在 DndContext 内部，
 * 不导出就没有任何回归保护。
 */
export function buildDragAccessibility(t: TFunction): {
  screenReaderInstructions: ScreenReaderInstructions;
  announcements: Announcements;
} {
  return {
    screenReaderInstructions: {
      draggable: t('dnd.instructions')
    },
    announcements: {
      onDragStart: ({ active }) =>
        t('dnd.grabbed', { title: dragLabel(active.data.current as DragData | undefined) }),
      onDragOver: ({ over }) =>
        over
          ? t('dnd.over', { title: dragLabel(over.data.current as DragData | undefined) })
          : undefined,
      onDragEnd: ({ over }) =>
        over
          ? t('dnd.dropped', { title: dragLabel(over.data.current as DragData | undefined) })
          : t('dnd.droppedNowhere'),
      onDragCancel: () => t('dnd.cancelled')
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
 * 标记「刚放下」：给 body 打一个一次性标记，指针下次移动即自动清除。
 *
 * 松手瞬间指针仍停在落点那一行，纯 `:hover` 会让拖拽把手继续显示——
 * 观感上像"拖完卡住了"，也与「把手只在 hover 时出现」的预期不符。
 * 打上标记后把手先隐藏，指针一动就恢复（此时已是真正的重新悬停）。
 */
/** 当前挂起的「刚放下」清理器：键盘拖拽（Space 放置）不产生指针移动，
 *  监听器会残留到下一次指针移动才批量清——每次标记前先清掉前一次的。 */
let pendingJustDroppedClear: (() => void) | null = null;

/** 导出供测试驱动（清理器残留是一类只在键盘拖拽下才出现的缺陷）。 */
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
 * - DragOverlay 提供跟随指针的丝滑拖拽视觉，替代原生 HTML5 DnD 的系统 ghost。
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
    // 松手处那一行会残留把手（指针还在上面），先抑制到指针再次移动为止。
    markJustDropped();
    onDragEnd(event);
  };
  const handleDragCancel = () => setOverlay(null);

  // 拖拽期间给 body 打标记：所有行的行尾操作都不再 hover 展开（配套规则见 main.css 的
  // body.dnd-dragging）——150px 的展开会挤动行内布局，叠加持续重测会让落点发飘。
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
