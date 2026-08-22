import type { TabRecord } from '@/core/tab-types';
import { inspectUrl } from '@/core/url/UrlInspector';

/**
 * 同 URL 唯一化（设置「同一网址只保留一个标签」的决策内核）。
 *
 * 纯决策层，不触碰 browser.*：
 *  - 按比较键（inspectUrl.comparisonKey）对标签分组；
 *  - 每组保留「最近访问」的一个（lastAccessed 最新；平局：激活 > 固定 > 位置靠前 > id 大）；
 *  - 其余（含新建标签）标记为待关闭。
 *
 * 使用场景：
 *  - 新建标签导航到已存在网址 → 对「既有」集合选保留者，激活它并关闭其余+新建；
 *  - 开关开启时对窗口内全部标签执行一次清理。
 */

export interface UrlDedupePlan {
  /** 保留者（最近访问）。 */
  keep: TabRecord;
  /** 待关闭的其余标签（不含 keep）。 */
  close: TabRecord[];
}

/**
 * 从一组同 URL 标签中选出保留者。
 * 「最新的一个」：lastAccessed 最大；平局依次比激活 / 固定 / 位置靠前 / id 大。
 */
export function rankForKeep(tabs: readonly TabRecord[]): TabRecord | undefined {
  return [...tabs].sort((a, b) => {
    const la = a.lastAccessed ?? 0;
    const lb = b.lastAccessed ?? 0;
    if (la !== lb) return lb - la;
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.index !== b.index) return a.index - b.index;
    return b.id - a.id;
  })[0];
}

/** 按比较键分组，每组超过一个时给出唯一化计划。 */
export function planUrlDedupe(tabs: readonly TabRecord[]): UrlDedupePlan[] {
  const buckets = new Map<string, TabRecord[]>();
  for (const tab of tabs) {
    const inspection = inspectUrl(tab.url, tab.pendingUrl);
    if (inspection.category !== 'web' || !inspection.comparisonKey) continue;
    const list = buckets.get(inspection.comparisonKey);
    if (list) list.push(tab);
    else buckets.set(inspection.comparisonKey, [tab]);
  }
  const plans: UrlDedupePlan[] = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    const keep = rankForKeep(group);
    if (!keep) continue;
    plans.push({ keep, close: group.filter((tab) => tab.id !== keep.id) });
  }
  return plans;
}
