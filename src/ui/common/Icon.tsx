import {
  Camera,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Bookmark,
  BookmarkPlus,
  Command,
  Copy,
  Folder,
  FolderInput,
  FolderOpen,
  GripVertical,
  History,
  LocateFixed,
  Menu,
  Pencil,
  Pin,
  Plus,
  Shield,
  Sparkles,
  Search,
  Settings,
  Snowflake,
  Sunrise,
  Tags,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
  X,
  type LucideIcon
} from 'lucide-react';

/**
 * 图标映射：统一使用 lucide-react 线性图标，
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
  /** 撤销历史。 */
  history: History,
  /** 命令面板入口（⌘ 符号，比键盘图标更直观）。 */
  shortcuts: Command,
  /** 固定文件夹保存为书签。 */
  bookmarkAdd: BookmarkPlus,
  /** 从书签导入。 */
  bookmarkImport: FolderInput,
  /** 一键删除（固定文件夹 / 原生分组），标签保留。 */
  trash: Trash2,
  /** 安全网指示：所有关闭都可撤销。 */
  shield: Shield,
  /** 会话快照（命名快照 / 关窗自动保存）。 */
  snapshot: Camera,
  /** 右键菜单（功能可发现性）。 */
  menu: Menu,
  /** 能力发现 Tip（友好高亮）。 */
  sparkles: Sparkles
} as const;

/** 通用图标渲染器：接收一个 LucideIcon 组件并透传 className / aria。 */
export function Icon({
  d,
  className,
  title
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
