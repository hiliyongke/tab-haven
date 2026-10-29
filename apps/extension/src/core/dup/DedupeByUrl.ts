import type { TabRecord } from '@/core/tab-types';

/**
 * 同 URL 保留者排序：全应用唯一的 keeper 口径（复用引擎与一键清理共用）。
 * 留「最近激活」的一个：lastActivatedAt 最大；平局依次比 激活 > 固定 > 位置靠前 > id 大。
 * 用 lastActivatedAt 而非面板侧被冻结的 lastAccessed，避免两处对同一组标签选出不同保留者。
 */
export function rankForKeep(tabs: readonly TabRecord[]): TabRecord | undefined {
  return [...tabs].sort((a, b) => {
    const la = a.lastActivatedAt ?? a.lastAccessed ?? 0;
    const lb = b.lastActivatedAt ?? b.lastAccessed ?? 0;
    if (la !== lb) return lb - la;
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.index !== b.index) return a.index - b.index;
    return b.id - a.id;
  })[0];
}
