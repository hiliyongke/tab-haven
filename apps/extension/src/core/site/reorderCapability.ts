/** 临时区列表内排序的可排序性。判定集中在此，供拖拽分发与 UI 共用，避免「能拖、拖了没反应」。 */

/** 排序被阻断的原因。 */
type ReorderBlockedReason =
  /** 标签顺序双向同步已关闭：写不回浏览器，排序无从持久化。 */
  | 'sync-off'
  /** 最近访问模式：显示顺序由冻结的 lastAccessed 决定，改 index 不反映到界面。视图语义限制，非故障。 */
  | 'recency';

interface ReorderBlockedInput {
  /** 标签顺序双向同步开关。 */
  tabOrderSync: boolean;
  /** 临时区排序方式。 */
  sortMode: 'browser' | 'recency';
}

/**
 * 返回阻断原因；`undefined` 表示允许列表内拖拽排序。
 *
 * 两个原因都必须显式告知，只是措辞重点不同：`sync-off` 是用户关的开关（提示去哪打开），
 * `recency` 是用户不易察觉的视图语义限制（提示切到浏览器顺序）。
 * 静默失效会让用户判定「拖拽坏了」—— 拖了一定有结果或有说明。
 */
export function reorderBlockedReason(input: ReorderBlockedInput): ReorderBlockedReason | undefined {
  if (!input.tabOrderSync) return 'sync-off';
  if (input.sortMode === 'recency') return 'recency';
  return undefined;
}
