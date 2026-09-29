import type { ReadLaterItem } from '@/core/schema/models';

/**
 * 稍后读过期阈值：暂存 7 天仍未读，面板提示归档（进快照，不丢数据）。
 */
export const READLATER_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 是否为「过期未读」：未读（无 readAt）且暂存时间超过阈值。
 * 已读条目不参与过期提示（读完成灰、由用户手动清理或忽略）。
 */
export function isReadLaterStale(item: ReadLaterItem, now: number = Date.now()): boolean {
  if (item.readAt !== undefined) return false;
  return now - item.addedAt > READLATER_STALE_MS;
}
