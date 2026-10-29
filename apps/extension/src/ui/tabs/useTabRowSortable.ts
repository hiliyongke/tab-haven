import { useMemo } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import type { RowItemContainer } from '@/ui/common/RowItem';
import { DragType } from '@/ui/dnd/types';

/**
 * 标签行的 dnd-kit 适配：排序状态 → `RowItem.container`。
 *
 * 从 `TabRow` 拆出的原因：这段是**第三方库的适配层**（拖拽数据构造、键盘/指针
 * 监听分流、transform 与过渡的换算），与行的内容渲染（徽章 / 操作 / 菜单）互不
 * 复用；同处一个文件时常被内容改动打断定位。
 *
 * 两个 memo 是性能红线而非风格偏好：解构 `sortable.listeners` 每次渲染都是新
 * 对象，直接下传会让 RowItem 的 memo 100% 失效 —— 大列表父级重渲染时全部行都
 * 要走一遍 reconcile。
 */
export function useTabRowSortable({
  tabId,
  containerKey,
  reorderEnabled,
  title,
  url,
  menuOpen
}: {
  tabId: number;
  containerKey: string;
  reorderEnabled: boolean;
  title: string;
  url?: string;
  /** 右键菜单是否展开（挂在主按钮的 aria-expanded 上，读屏可播报）。 */
  menuOpen: boolean;
}): RowItemContainer {
  // 排序使用 dnd-kit：始终可拖（跨容器拖到固定空间不受排序开关影响），
  // 列表内排序是否生效由 App 层按 tabOrderSync 设置控制。
  const sortable = useSortable({
    id: tabId,
    // 关掉让位过渡：其余行会在 200ms 内持续位移，而碰撞检测读的是实时矩形，
    // 动画期间矩形一直在变，落点随之漂移 —— 表现为「松手前要停一下才准」。
    // 去掉过渡后元素瞬间到位，矩形立即稳定，落点与所见一致。
    transition: null,
    data: {
      type: DragType.Tab,
      tabId,
      containerKey,
      // 行间排序是否可用（false = 超阈值强制虚拟化分区的行：UI 已提示
      // 「拖拽排序已暂停」，但行仍保留 draggable/droppable 以支持跨容器
      // 拖到固定空间）。拖放分发据此拦截 Tab→Tab 真实排序——否则出现
      // 「提示暂停、松手却真实重排」的行为矛盾。
      canReorder: reorderEnabled,
      title,
      // 拖拽跟随层根据页面 URL 通过浏览器通道获取对应 favicon。
      url
    }
  });

  // 键盘拖拽与指针拖拽分流：键盘监听挂主按钮（KeyboardSensor 要求 keydown 目标即 activator），
  // 指针监听挂整行（PointerSensor 无目标限制），两者不会为同一事件重复激活。
  const sortableKeyDown = sortable.listeners?.onKeyDown as
    ((event: ReactKeyboardEvent<HTMLButtonElement>) => void) | undefined;
  const sortablePointerListeners = useMemo(() => {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sortable.listeners ?? {})) {
      if (key !== 'onKeyDown') rest[key] = value;
    }
    return rest;
  }, [sortable.listeners]);
  const buttonListeners = useMemo(
    () => (sortableKeyDown ? { onKeyDown: sortableKeyDown } : undefined),
    [sortableKeyDown]
  );

  // container 依赖只取标量字段：useSortable 的内部对象每次渲染都是新引用，
  // 取对象做依赖会让 container 在「排序状态未变」时也不稳定。
  const transformX = sortable.transform?.x;
  const transformY = sortable.transform?.y;
  const {
    transition: sortTransition,
    isDragging,
    setNodeRef,
    setActivatorNodeRef,
    attributes
  } = sortable;

  return useMemo(
    () => ({
      ref: setNodeRef,
      activatorRef: setActivatorNodeRef,
      // 主按钮是行内唯一的交互元素：菜单可弹出/已展开的状态挂在这里（读屏可播报），
      // 而不是挂在不参与交互的 li 上。
      buttonAttributes: {
        ...attributes,
        'aria-haspopup': 'menu',
        'aria-expanded': menuOpen
      },
      listeners: sortablePointerListeners,
      buttonListeners,
      style: {
        transform:
          transformX || transformY
            ? `translate3d(${transformX ?? 0}px, ${transformY ?? 0}px, 0)`
            : undefined,
        transition: sortTransition
      },
      className: isDragging ? 'is-sorting' : undefined
    }),
    [
      setNodeRef,
      setActivatorNodeRef,
      attributes,
      menuOpen,
      sortablePointerListeners,
      buttonListeners,
      transformX,
      transformY,
      sortTransition,
      isDragging
    ]
  );
}
