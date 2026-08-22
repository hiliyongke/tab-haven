import {
  ChevronRight,
  Copy,
  Folder,
  FolderDown,
  FolderInput,
  GripVertical,
  Group,
  Layers,
  List,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Snowflake,
  Star,
  Trash2,
  Volume2,
  VolumeX,
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
  pin: Pin,
  mute: Volume2,
  muted: VolumeX,
  list: List,
  search: Search,
  trash: Trash2,
  pencil: Pencil,
  grip: GripVertical,
  copy: Copy,
  snowflake: Snowflake,
  group: Group,
  folder: Folder,
  folderInput: FolderInput,
  /** 存为固定文件夹（文件夹 + 存入箭头，替代 FolderInput 的不直观表达）。 */
  folderDown: FolderDown,
  /** 新建标签组（分层归类语义，替代 FolderInput 的不贴切表达）。 */
  layers: Layers,
  settings: Settings,
  star: Star,
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
