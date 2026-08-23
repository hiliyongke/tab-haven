/**
 * 全局 dnd-kit 拖拽数据模型。
 * 所有参与拖拽的元素（标签行/分组头/固定条目/文件夹/永久固定磁贴）通过
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

interface TabDragData {
  type: (typeof DragType)['Tab'];
  tabId: number;
  /** 所属容器 key（section key），用于判断同容器排序。 */
  containerKey: string;
  title: string;
  favIconUrl?: string;
}

export interface SectionDragData {
  type: (typeof DragType)['Section'];
  sectionKey: string;
  /** 原生分组时存在。 */
  groupId?: number;
  title: string;
  tabIds: number[];
}

interface PinDragData {
  type: (typeof DragType)['Pin'];
  /** 持久化 pin id（PinnedStrip 场景）。 */
  pinId?: string;
  /** 浏览器原生标签 id（SectionList 内浏览器置顶场景）。 */
  tabId?: number;
  title: string;
  favIconUrl?: string;
}

interface FolderDragData {
  type: (typeof DragType)['Folder'];
  folderId: string;
  name: string;
}

interface FolderItemDragData {
  type: (typeof DragType)['FolderItem'];
  folderId: string;
  itemId: string;
  title: string;
  favIconUrl?: string;
}

export type DragData =
  | TabDragData
  | SectionDragData
  | PinDragData
  | FolderDragData
  | FolderItemDragData;

/** 固定空间整体投放目标（拖到空白处创建新文件夹）。 */
export const FIXED_AREA_DROPPABLE = 'fixed-area';
/** 顶部永久固定图标区投放目标（拖标签到此固定）。 */
export const PINNED_STRIP_DROPPABLE = 'pinned-strip';

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
