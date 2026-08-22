/**
 * 临时区列表内排序的「可排序性」。
 *
 * 判定集中在这里，供拖拽分发（`onDragEnd`）与 UI 共用，避免
 * 「界面看着能拖、拖了却没反应」这类不一致 —— 那是本项目踩过最多次的坑。
 *
 * core 层：不触碰 chrome.* / DOM / React，纯判定。
 */

/** 排序被阻断的原因。 */
export type ReorderBlockedReason =
  /** 标签顺序双向同步已关闭：写不回浏览器，排序无从持久化。 */
  | 'sync-off'
  /**
   * 最近访问模式：显示顺序由冻结的 lastAccessed 决定，与 index 已解耦，
   * 此时拖拽改 index 不会反映到界面。这是视图语义限制，不是故障。
   */
  | 'recency';

export interface ReorderBlockedInput {
  /** 标签顺序双向同步开关。 */
  tabOrderSync: boolean;
  /** 临时区排序方式：browser 浏览器原生顺序 / recency 最近访问。 */
  sortMode: 'browser' | 'recency';
}

/**
 * 返回阻断原因；`undefined` 表示允许列表内拖拽排序。
 *
 * 两个原因的处理方式**应当不同**：
 *  - `sync-off` 是用户主动关的开关 → 静默即可，不必打扰；
 *  - `recency` 是用户不易察觉的视图语义限制 → 必须显式告知，
 *    否则只会让人以为功能坏了。
 */
export function reorderBlockedReason(input: ReorderBlockedInput): ReorderBlockedReason | undefined {
  if (!input.tabOrderSync) return 'sync-off';
  if (input.sortMode === 'recency') return 'recency';
  return undefined;
}
