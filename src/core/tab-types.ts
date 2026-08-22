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
  /** 是否已休眠（chrome.tabs.Tab.discarded）。 */
  discarded?: boolean;
  /** 静音状态（来自 mutedInfo）。 */
  muted?: boolean;
  /** 是否正在播放声音。 */
  audible?: boolean;
  /** 原生标签组 id（NO_GROUP = -1）。 */
  groupId: number;
  /** Chrome 140+ 拆分视图 id（无拆分时为 undefined）。 */
  splitViewId?: number;
  /** 最后访问时间戳（ms），用于「最近访问」排序。 */
  lastAccessed?: number;
  /** 是否允许被浏览器自动休眠（chrome.tabs.autoDiscardable）。 */
  autoDiscardable?: boolean;
  /** 来源标签 id（tabs.Tab.openerTabId），用于「来源树」分组。 */
  openerTabId?: number;
  /** 是否需要关注（tabs.Tab.attention，如下载完成/响铃等）。 */
  attention?: boolean;
  /** 页面语言（BCP-47，来自 detectLanguage 异步探测）。 */
  language?: string;
}

/** 原生标签组（Chrome tabGroups 子集，只读安全映射）。 */
export interface TabGroupRecord {
  id: number;
  title?: string;
  color?: string;
  collapsed?: boolean;
}

/** 判断标签是否满足基础安全休眠条件。浏览器 API 无法可靠暴露未提交表单状态，因此保守跳过活跃、固定、播放声音、需要关注、加载中和禁止自动休眠的标签。 */
export function canSafelyDiscardTab(tab: Pick<TabRecord, 'active' | 'pinned' | 'discarded' | 'audible' | 'attention' | 'status' | 'autoDiscardable'>): boolean {
  return (
    !tab.active &&
    !tab.pinned &&
    !tab.discarded &&
    !tab.audible &&
    !tab.attention &&
    tab.status !== 'loading' &&
    tab.autoDiscardable !== false
  );
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
