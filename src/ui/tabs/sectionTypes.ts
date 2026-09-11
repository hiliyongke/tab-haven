import type { TabRecord } from '@/core/tab-types';
import type { TemporarySection } from '@/core/site/Sections';

/** 卡片与行渲染共享的回调契约（SectionList 对外下发的标签交互入口）。 */
export interface SectionCallbacks {
  onActivate: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onCloseTab: (tab: TabRecord) => void;
  onDuplicate?: (tab: TabRecord) => void;
  onDiscard?: (tab: TabRecord) => void;
  /** 原生组 → 固定文件夹桥接。 */
  onSaveGroupAsFolder?: (groupId: number) => void;
  onToggleGroupCollapsed: (groupId: number, collapsed: boolean) => void;
  onToggleSiteCollapsed: (siteKey: string, collapsed: boolean) => void;
  /** 拖拽重排写回原生顺序（可选能力，由设置开关控制）。 */
  onReorder?: (sourceId: number, targetId: number, placeAfter: boolean) => void;
  /** 键盘重排（Alt+↑/↓）：把标签向相邻位置移动。 */
  onMoveTab?: (tabId: number, direction: -1 | 1) => void;
  onGroupRename: (groupId: number, title: string) => void;
  onGroupRecolor: (groupId: number, color: string) => void;
  onGroupMove: (groupId: number, index: number) => void;
  /** 与浏览器多选选区同步。 */
  onHighlightSelected?: () => void;
}

/** SectionCard 全部输入（跨子组件共享）。 */
export interface SectionCardProps {
  section: TemporarySection;
  collapsedGroups: ReadonlySet<number>;
  collapsedSites: ReadonlySet<string>;
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  splitPartners: ReadonlySet<number>;
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy' | 'large';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  highlightedIds?: ReadonlySet<number>;
  searchActiveTabId?: number;
  noCacheTabIds?: ReadonlySet<number>;
  callbacks: SectionCallbacks;
}

/** RowList 的透传输入（SectionCardProps 中与行渲染相关的字段）。 */
export type RowListPassthrough = Pick<
  SectionCardProps,
  | 'duplicateCounts'
  | 'activeTabId'
  | 'splitPartners'
  | 'reorderEnabled'
  | 'showUrl'
  | 'rowActionsVisible'
  | 'autoScrollActive'
  | 'closeOnMiddleClick'
  | 'density'
  | 'showSplitBadges'
  | 'highlightedIds'
  | 'searchActiveTabId'
  | 'noCacheTabIds'
  | 'callbacks'
>;
