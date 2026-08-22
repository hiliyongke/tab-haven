import type { UndoBatch } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';

/**
 * 撤销栈（操作记录制，非状态快照制——FR-D8.1）。
 *
 * 记录"补偿操作"所需的最小信息（URL/位置/固定/静音/分组归属），
 * 撤销 = 用记录重建标签；栈深上限（可由设置调整）、FIFO 淘汰、可持久化。
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
    groupId: tab.groupId ?? NO_GROUP,
    groupName: tab.groupId !== NO_GROUP ? groupNameById.get(tab.groupId) : undefined
  };
}

/** 入栈（保持顺序），超限 FIFO 淘汰；limit 来自设置（默认 10）。 */
export function pushBatch(
  batches: UndoBatch[],
  batch: UndoBatch,
  limit = DEFAULT_UNDO_STACK_LIMIT
): UndoBatch[] {
  return [...batches, batch].slice(-limit);
}

/** 弹栈：返回 [最新批次, 剩余批次]。 */
export function popBatch(batches: UndoBatch[]): [UndoBatch | undefined, UndoBatch[]] {
  const latest = batches.at(-1);
  return [latest, batches.slice(0, -1)];
}

export function createUndoBatch(
  kind: string,
  entries: UndoBatch['entries']
): UndoBatch {
  return {
    id: crypto.randomUUID(),
    kind,
    createdAt: Date.now(),
    entries
  };
}
