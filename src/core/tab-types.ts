/**
 * 领域层最小 Tab 类型（与 chrome.tabs.Tab 结构兼容的子集）。
 *
 * core 层零 chrome 依赖：platform/tabs 负责把 chrome.tabs.Tab 映射为
 * TabRecord；其余各层只消费 TabRecord。
 */
export interface TabRecord {
  id: number;
  windowId: number;
  index: number;
  active: boolean;
  pinned: boolean;
  incognito: boolean;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  status?: string;
  /** 静音状态（来自 mutedInfo）。 */
  muted?: boolean;
  /** 是否正在播放声音。 */
  audible?: boolean;
  /** 原生标签组 id（NO_GROUP = -1）。 */
  groupId: number;
  /** Chrome 140+ 拆分视图 id（无拆分时为 undefined）。 */
  splitViewId?: number;
}

/** 原生标签组（Chrome tabGroups 子集，只读安全映射）。 */
export interface TabGroupRecord {
  id: number;
  title?: string;
  color?: string;
  collapsed?: boolean;
}

export const NO_GROUP = -1;

/** 原生组 9 色（展示用，与 Chrome 对齐）。 */
export const GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
] as const;
