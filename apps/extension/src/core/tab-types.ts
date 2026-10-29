/**
 * 领域层最小 Tab 类型（与 chrome.tabs.Tab 结构兼容的子集）。
 * core 层零 chrome 依赖：platform/tabs 负责把 chrome.tabs.Tab 映射为 TabRecord，其余各层只消费它。
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
  audible?: boolean;
  /** 原生标签组 id（NO_GROUP = -1）。 */
  groupId: number;
  /** Chrome 140+ 拆分视图 id（无拆分时为 undefined）。 */
  splitViewId?: number;
  /**
   * 最后访问时间戳（ms），用于「最近访问」**排序**。
   * 面板侧该值被 `mergeSnapshotTabs` 冻结在「标签首次出现」的时刻（见下方合并注释），
   * 语义是「排序键」，不是「真实最近激活时刻」。
   */
  lastAccessed?: number;
  /**
   * 浏览器**实时**的最近激活时间戳（ms），不冻结（`mergeSnapshotTabs` 不保留旧值）。
   *
   * 两值并存因为它们回答两个不同问题：
   *  - `lastAccessed` 冻结是**排序稳定性**要求：浏览器每次激活/导航都刷新它，照单全收会让
   *    「最近访问」分区与行随每次切换标签全量重排；
   *  - 但冻结值对**时间判定**是错的：滞留预警与 keeper 判定问的是「真实最近一次激活在什么时候」，
   *    用冻结值会把「8 天前打开、刚刚才切过的标签」判成「8 天没动过」，并与后台复用引擎
   *    （直查浏览器实时值）口径分叉——两处对同一组标签选出不同的保留者。
   *
   * 分工固定：**排序消费 `lastAccessed`（冻结），时间判定消费 `lastActivatedAt`（实时）**。
   * 回退到 `lastAccessed` 只在 `lastActivatedAt` 缺失时发生（非 chrome 来源的合成记录）。
   */
  lastActivatedAt?: number;
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

/** 「不在任何原生标签组」的哨兵值（Chrome 的 TAB_GROUP_ID_NONE）。 */
export const NO_GROUP = -1;

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
  'lastActivatedAt',
  'autoDiscardable',
  'openerTabId',
  'attention',
  'language'
] as const satisfies readonly (keyof TabRecord)[];

/**
 * 完备性断言：`satisfies` 保证列出的字段均有效，函数类型条件同时确保没有遗漏。
 * 漏登记字段时目标类型为 `never`，函数赋值会导致编译失败。
 */
const sameTabFields: Exclude<keyof TabRecord, (typeof TAB_FIELDS)[number]> extends never
  ? (a: TabRecord, b: TabRecord) => boolean
  : never = (a: TabRecord, b: TabRecord): boolean => {
  for (const field of TAB_FIELDS) {
    if (a[field] !== b[field]) return false;
  }
  return true;
};

/**
 * 快照合并：把浏览器新快照并入面板侧镜像（tabStore 订阅 TabSyncService 时调用）。
 *
 * 面板侧在 chrome.tabs.Tab 之外维护两类「镜像增量信息」，快照广播不含它们，需按 id 从上一帧保留：
 *  - language：面板异步探测的结果，仅 URL 未变时保留（已导航则需重新探测）；
 *  - lastAccessed（排序冻结）：浏览器每次激活/导航都刷新它，照单全收会让「最近访问」分区与行
 *    随每次切换标签全量重排。这里对既有标签冻结旧值——新标签以最新时间戳就位，其余保持相对顺序。
 *
 * 背景侧（自动休眠 / 复用合并）不经过此函数：它们直查浏览器拿实时 lastAccessed。
 * `lastActivatedAt` 刻意**不冻结**：它是给时间判定用的实时值，冻结就退化成第二个 `lastAccessed`。
 */
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
