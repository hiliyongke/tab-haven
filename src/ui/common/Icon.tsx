import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Bookmark,
  BookmarkPlus,
  Copy,
  Folder,
  FolderInput,
  FolderOpen,
  GripVertical,
  History,
  Keyboard,
  LocateFixed,
  Pencil,
  Percent,
  Pin,
  Plus,
  Search,
  Settings,
  Snowflake,
  Sunrise,
  Tags,
  Volume2,
  VolumeX,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * 图标映射：用 lucide-react 的线性图标替换原先手绘 SVG 路径，
 * 造型统一、可访问性更好。新增图标只需在此追加并 import 对应组件。
 *
 * `Icons` 的值是 LucideIcon 组件本身，沿用旧调用点
 * `<Icon d={Icons.plus} className="h-3.5 w-3.5" />` 无需改动。
 */
export const Icons = {
  plus: Plus,
  close: X,
  chevron: ChevronRight,
  collapseAll: ChevronsDownUp,
  expandAll: ChevronsUpDown,
  pin: Pin,
  mute: Volume2,
  muted: VolumeX,
  search: Search,
  pencil: Pencil,
  grip: GripVertical,
  copy: Copy,
  /** 休眠标签（释放内存）。 */
  snowflake: Snowflake,
  /** 转换为原生分组：标签集图标，表达「归类成组」。 */
  toNativeGroup: Tags,
  /** 快速整理（自动分组）：魔法棒表达「一键自动归组」。 */
  quickRegroup: Wand2,
  folder: Folder,
  /** 存为固定文件夹：书签表达「收藏固定」。 */
  saveToFolder: Bookmark,
  locate: LocateFixed,
  settings: Settings,
  /** 打开文件夹全部条目。 */
  openAll: FolderOpen,
  /** 唤醒全部休眠标签。 */
  wakeAll: Sunrise,
  /** 缩放一键重置。 */
  zoomReset: Percent,
  /** 撤销历史。 */
  history: History,
  /** 快捷键帮助。 */
  shortcuts: Keyboard,
  /** 固定文件夹保存为书签。 */
  bookmarkAdd: BookmarkPlus,
  /** 从书签导入。 */
  bookmarkImport: FolderInput,
} as const;

/** 通用图标渲染器：接收一个 LucideIcon 组件并透传 className / aria。 */
export function Icon({
  d,
  className,
  title,
}: {
  d: LucideIcon;
  className?: string;
  title?: string;
}) {
  const Cmp = d;
  return (
    <Cmp className={className} aria-hidden={title ? undefined : 'true'}>
      {title ? <title>{title}</title> : null}
    </Cmp>
  );
}
