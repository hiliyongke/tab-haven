import type { ReadLaterItem } from '@/core/schema/models';
import { READLATER_LIMIT } from '@/core/schema/models';

/**
 * 稍后读容量裁剪：超限时**淘汰最旧**，保留新加入的条目。
 *
 * 不能直接用 `slice(0, limit)`：新增条目是追加在数组末尾的，从头裁会
 * 恰好把刚存的那条切掉——用户点「稍后读」收到成功提示，列表里却没有。
 */
export function trimReadLater(
  items: readonly ReadLaterItem[],
  limit: number = READLATER_LIMIT
): ReadLaterItem[] {
  if (items.length <= limit) return [...items];
  const sorted = [...items].sort((a, b) => a.addedAt - b.addedAt);
  return sorted.slice(sorted.length - limit);
}
