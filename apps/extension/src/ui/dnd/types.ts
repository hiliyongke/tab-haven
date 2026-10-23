/**
 * 全局 dnd-kit 拖拽数据模型。
 * 所有参与拖拽的元素（标签行 / 分组头 / 固定条目 / 文件夹 / 常驻磁贴）通过
 * useSortable / useDroppable 的 `data` 携带这里的类型信息，由 App 层统一的
 * onDragEnd 依据类型分发到对应的排序 / 投放逻辑。
 */

export const DragType = {
  Tab: 'tab',
  Section: 'section',
  Pin: 'pin',
  Folder: 'folder',
  FolderItem: 'folder-item'
} as const;

export interface TabDragData {
  type: (typeof DragType)['Tab'];
  tabId: number;
  /** 所属容器 key（section key），用于判断同容器排序。 */
  containerKey: string;
  /**
   * 行间排序是否可用（false = 超阈值强制虚拟化分区）。
   * 拖放分发据此拦截 Tab→Tab 真实排序：虚拟行仍保留 draggable/droppable
   * 以支持跨容器拖到固定空间，但行间落点必须忽略。
   */
  canReorder: boolean;
  title: string;
  /** 图标所属页面地址（不是图标地址）：拖拽跟随层用它向浏览器 favicon 通道取图。 */
  url?: string;
}

export interface SectionDragData {
  type: (typeof DragType)['Section'];
  sectionKey: string;
  /** 原生分组时存在。 */
  groupId?: number;
  title: string;
  tabIds: number[];
}

export interface PinDragData {
  type: (typeof DragType)['Pin'];
  /** 持久化 pin id（PinnedStrip 场景）。 */
  pinId?: string;
  /** 浏览器原生标签 id（SectionList 内浏览器置顶场景）。 */
  tabId?: number;
  title: string;
  /** 图标所属页面地址（不是图标地址）。 */
  url?: string;
}

export interface FolderDragData {
  type: (typeof DragType)['Folder'];
  folderId: string;
  name: string;
}

export interface FolderItemDragData {
  type: (typeof DragType)['FolderItem'];
  folderId: string;
  itemId: string;
  title: string;
  /** 图标所属页面地址（不是图标地址）。 */
  url?: string;
}

export type DragData =
  TabDragData | SectionDragData | PinDragData | FolderDragData | FolderItemDragData;

/** 固定空间整体投放目标（拖到空白处创建新文件夹）。 */
export const FIXED_AREA_DROPPABLE = 'fixed-area';
/** 顶部常驻磁贴区投放目标（拖标签到此固定）。 */
export const PINNED_STRIP_DROPPABLE = 'pinned-strip';

/**
 * 纯落点数据：这类 droppable 不接受「被拖起来」，只作为投放区存在。
 * `type` 与上面的 DOM id 常量同值（两套语义本就一一对应）。
 */
interface DropZoneData {
  type: typeof FIXED_AREA_DROPPABLE | typeof PINNED_STRIP_DROPPABLE;
}

/** 落点上可能出现的全部 data 形态（拖拽源 5 类 + 投放区 2 类）。 */
export type DropTargetData = DragData | DropZoneData;

/** 判断两个拖拽元素是否属于同一容器（同一列表内才允许排序）。 */
export function isSameContainer(a: DragData | undefined, b: DragData | undefined): boolean {
  if (!a || !b || a.type !== b.type) return false;
  switch (a.type) {
    case DragType.Tab:
      return b.type === DragType.Tab && a.containerKey === b.containerKey;
    case DragType.FolderItem:
      return b.type === DragType.FolderItem && a.folderId === b.folderId;
    default:
      return true;
  }
}
