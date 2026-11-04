import type { UndoBatch, UndoTabRecord } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { pushBatch } from '@/core/undo/UndoStack';
import { webComparisonKey } from '@/core/url/UrlInspector';

/** 从原批次剔除实际关闭项；未匹配与关闭失败项都留在原操作栈供重试。 */
export function entriesRemainingAfterClose(
  entries: readonly UndoTabRecord[],
  closed: readonly TabRecord[]
): UndoTabRecord[] {
  const remaining = [...entries];
  for (const tab of closed) {
    const tabKey = webComparisonKey(tab.url, tab.pendingUrl);
    const index = remaining.findIndex((record) =>
      tabKey !== null
        ? webComparisonKey(record.url, undefined) === tabKey
        : record.url === (tab.url ?? '')
    );
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

/**
 * 同一撤销批次可能经多次重试才全部恢复。把各次成功项合并为一个重做批次，
 * 避免同 id 批次重复入栈、身份映射互相覆盖，且一次重做即可关闭全部恢复产物。
 */
export function pushMergedRedoBatch(
  batches: UndoBatch[],
  batch: UndoBatch,
  limit: number
): UndoBatch[] {
  const previous = batches.findLast((entry) => entry.id === batch.id);
  const merged = previous ? { ...batch, entries: [...previous.entries, ...batch.entries] } : batch;
  return pushBatch(
    batches.filter((entry) => entry.id !== batch.id),
    merged,
    limit
  );
}
