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
export function canSafelyDiscardTab(
  tab: Pick<
    TabRecord,
    | 'active'
    | 'pinned'
    | 'discarded'
    | 'audible'
    | 'attention'
    | 'status'
    | 'autoDiscardable'
    | 'lastAccessed'
  >
): boolean {
  return (
    !tab.active &&
    !tab.pinned &&
    !tab.discarded &&
    !tab.audible &&
    !tab.attention &&
    tab.status !== 'loading' &&
    tab.autoDiscardable !== false &&
    typeof tab.lastAccessed === 'number' &&
    Number.isFinite(tab.lastAccessed)
  );
}

export const NO_GROUP = -1;

/**
 * 快照合并：把浏览器新快照并入面板侧镜像（tabStore 订阅 TabSyncService 时调用）。
 *
 * 面板侧在 chrome.tabs.Tab 之外维护两类「镜像增量信息」，快照广播不含它们，
 * 需按 id 从上一帧保留：
 *  - language：面板异步探测的结果。仅 URL 未变时保留（已导航则需重新探测）；
 *  - lastAccessed（排序冻结）：浏览器会在每次激活/导航时刷新该时间戳，
 *    若照单全收，「最近访问」排序会随每次切换标签全量重排（分区与行不停跳动）。
 *    这里对既有标签冻结旧值——排序只在「新页面打开」（新 id 首次出现）时
 *    一次性纳入：新标签以最新时间戳就位，其余标签保持既有相对顺序。
 *
 * 背景侧（自动休眠 / 复用合并）不经过此函数：它们直接查询浏览器拿实时
 * lastAccessed，不受冻结影响。
 */
/** TabRecord 全字段逐值比较（引用保持判等用）。 */
const TAB_FIELDS = [
  'id',
  'windowId',
  'index',
  'active',
  'pinned',
  'incognito',
  'url',
  'pendingUrl',
  'title',
  'favIconUrl',
  'status',
  'discarded',
  'muted',
  'audible',
  'groupId',
  'splitViewId',
  'lastAccessed',
  'autoDiscardable',
  'openerTabId',
  'attention',
  'language'
] as const satisfies readonly (keyof TabRecord)[];

// 完备性断言：satisfies 只保证「列出的都是合法字段」，不能保证「全部字段都已列出」。
// TabRecord 新增字段而未登记时这里编译失败——否则 sameTabFields 漏比该字段，
// 引用保持逻辑会把变更后的对象误判为不变，UI 静默不刷新。
type TabFieldsMustCoverAll =
  Exclude<keyof TabRecord, (typeof TAB_FIELDS)[number]> extends never ? true : never;
const tabFieldsCoverAll: TabFieldsMustCoverAll = true;
void tabFieldsCoverAll;

function sameTabFields(a: TabRecord, b: TabRecord): boolean {
  for (const field of TAB_FIELDS) {
    if (a[field] !== b[field]) return false;
  }
  return true;
}

export function mergeSnapshotTabs(
  prevTabs: readonly TabRecord[],
  incoming: readonly TabRecord[]
): TabRecord[] {
  const prevById = new Map(prevTabs.map((tab) => [tab.id, tab]));
  return incoming.map((tab) => {
    const prev = prevById.get(tab.id);
    if (!prev) return tab;
    let merged = tab;
    if (prev.language !== undefined && prev.url === tab.url && prev.pendingUrl === tab.pendingUrl) {
      merged = { ...merged, language: prev.language };
    }
    if (typeof prev.lastAccessed === 'number') {
      merged = { ...merged, lastAccessed: prev.lastAccessed };
    }
    // 引用保持：合并结果与上一帧逐字段相等时复用 prev 引用。
    // 下游 memo 链（SectionCard / TabRow / RowItem）以 tab 引用稳定为前提跳过未变化行；
    // 浏览器 query 每次返回全新对象，不做这一步，任何一个标签变化都会让整棵列表树 reconcile。
    return sameTabFields(prev, merged) ? prev : merged;
  });
}
