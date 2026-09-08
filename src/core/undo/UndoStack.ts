import type { UndoBatch } from '@/core/schema/models';
import { DEFAULT_UNDO_STACK_LIMIT } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';

/**
 * 撤销栈：操作记录制而非状态快照制。
 * 只记录重建标签所需的最小信息，撤销 = 用记录重建，因此可跨会话持久化。
 *
 * 默认深度 `DEFAULT_UNDO_STACK_LIMIT` 来自 models.ts 的 schema 默认值，
 * 上限的唯一来源在此（undoStore 实际以 `settings.undoStackLimit` 调用，
 * 此常量仅为未显式传参时的兜底，避免与 schema 双定义而悄悄分叉）。
 */

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

/**
 * 撤销批次的可注入入参。
 *
 * `id` / `now` 默认取宿主时钟与随机源。core 其余部分是纯函数，这里刻意留出注入点：
 * 撤销批次需要唯一 id 与时间戳，但把它们硬编码在领域层会让单测不可重现。
 */
export interface CreateUndoBatchOptions {
  /** 关闭发生时的窗口 id（撤销回到原窗口）。 */
  windowId?: number;
  /** 批次创建时间戳（默认 Date.now()）。 */
  now?: number;
  /** 批次 id（默认 crypto.randomUUID()）。 */
  id?: string;
}

export function createUndoBatch(
  kind: string,
  entries: UndoBatch['entries'],
  options: CreateUndoBatchOptions = {}
): UndoBatch {
  return {
    id: options.id ?? crypto.randomUUID(),
    kind,
    createdAt: options.now ?? Date.now(),
    windowId: options.windowId,
    entries
  };
}
