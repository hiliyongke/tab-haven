import type { UndoBatch } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';

/**
 * 撤销栈：操作记录制而非状态快照制。
 * 只记录重建标签所需的最小信息，撤销 = 用记录重建，因此可跨会话持久化。
 */

export const DEFAULT_UNDO_STACK_LIMIT = 10;

/** 从标签快照生成撤销记录（五元组 + 组名）。 */
export function toUndoTabRecord(
  tab: TabRecord,
  groupNameById: ReadonlyMap<number, string | undefined>
): UndoBatch['entries'][number] {
  return {
    url: tab.url ?? '',
    index: tab.index,
    pinned: tab.pinned,
    muted: Boolean(tab.muted),
    groupId: tab.groupId,
    groupName: tab.groupId !== NO_GROUP ? groupNameById.get(tab.groupId) : undefined
  };
}

/** 入栈，超限按 FIFO 淘汰。 */
export function pushBatch(
  batches: UndoBatch[],
  batch: UndoBatch,
  limit = DEFAULT_UNDO_STACK_LIMIT
): UndoBatch[] {
  // slice(-0) 等价于 slice(0)（保留全量），limit 须钳到 ≥1 才能维持淘汰语义。
  const cap = Math.max(1, Math.floor(limit));
  return [...batches, batch].slice(-cap);
}

/** 弹栈：返回 [最新批次, 剩余批次]。 */
export function popBatch(batches: UndoBatch[]): [UndoBatch | undefined, UndoBatch[]] {
  const latest = batches.at(-1);
  return [latest, batches.slice(0, -1)];
}

export function createUndoBatch(kind: string, entries: UndoBatch['entries']): UndoBatch {
  return {
    id: crypto.randomUUID(),
    kind,
    createdAt: Date.now(),
    entries
  };
}
