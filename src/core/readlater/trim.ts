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

/**
 * 同上，但**返回被淘汰的条目**（R18 / S-3）。
 *
 * 纯函数层没有 notify 通道（core 不得依赖 UI/store），所以「告知用户」只能由调用方
 * 完成：这里把淘汰项交出去，由 store 决定如何提示。此前超限时旧条目被静默丢弃 ——
 * 用户以为一直在存，实际最早的那些已经没了。
 */
export function trimReadLaterWithEvicted(
  items: readonly ReadLaterItem[],
  limit: number = READLATER_LIMIT
): { kept: ReadLaterItem[]; evicted: ReadLaterItem[] } {
  if (items.length <= limit) return { kept: [...items], evicted: [] };
  const sorted = [...items].sort((a, b) => a.addedAt - b.addedAt);
  const cut = sorted.length - limit;
  return { kept: sorted.slice(cut), evicted: sorted.slice(0, cut) };
}
