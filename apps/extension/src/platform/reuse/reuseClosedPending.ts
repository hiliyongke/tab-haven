import { z } from 'zod';
import { browser } from 'wxt/browser';
import { ACK_TIMEOUT_MS, REUSE_CLOSED_LIMIT } from '@/platform/messages';
import { UndoTabRecordSchema } from '@/core/schema/models';
import { REUSE_CLOSED_PENDING_KEY } from '@/platform/storage/keys';

const ReuseClosedShardSchema = z.object({
  batchId: z.string().min(1).max(128),
  windowId: z.number().int(),
  records: z.array(UndoTabRecordSchema).max(REUSE_CLOSED_LIMIT),
  shardIndex: z.number().int().nonnegative(),
  shardCount: z.number().int().positive(),
  at: z.number().int().nonnegative()
});

type ReuseClosedShard = z.infer<typeof ReuseClosedShardSchema>;
const ReuseClosedShardListSchema = z.array(ReuseClosedShardSchema);

function key(batchId: string, shardIndex: number): string {
  return `${REUSE_CLOSED_PENDING_KEY}:${batchId}:${shardIndex}`;
}

export async function writeReuseClosedShards(shards: readonly ReuseClosedShard[]): Promise<void> {
  const area = browser.storage?.session;
  if (!area) throw new Error('Storage area unavailable: reuse-closed-pending');
  await area.set(
    Object.fromEntries(
      shards.map((shard) => [
        key(shard.batchId, shard.shardIndex),
        ReuseClosedShardSchema.parse(shard)
      ])
    )
  );
}

export async function readReuseClosedBatch(
  batchId: string,
  shardCount: number
): Promise<ReuseClosedShard[]> {
  const area = browser.storage?.session;
  if (!area) throw new Error('Storage area unavailable: reuse-closed-pending');
  const keys = Array.from({ length: shardCount }, (_, index) => key(batchId, index));
  const stored = await area.get(keys);
  const parsed = ReuseClosedShardListSchema.safeParse(
    keys.map((name) => stored[name]).filter((value) => value !== undefined)
  );
  if (!parsed.success || parsed.data.length !== shardCount) {
    throw new Error(`Reuse-closed batch incomplete: ${batchId}`);
  }
  return parsed.data.sort((left, right) => left.shardIndex - right.shardIndex);
}

export async function removeReuseClosedBatch(batchId: string, shardCount: number): Promise<void> {
  const area = browser.storage?.session;
  if (!area) throw new Error('Storage area unavailable: reuse-closed-pending');
  await area.remove(Array.from({ length: shardCount }, (_, index) => key(batchId, index)));
}

interface AckWaiter {
  promise: Promise<boolean>;
  resolve: (acknowledged: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const ackWaiters = new Map<string, AckWaiter>();

/** 注册一次 batchId 的 UI ACK 等待；超时按「未确认」让 SW 直接补写撤销库。 */
export function waitForReuseClosedAck(
  batchId: string,
  timeoutMs = ACK_TIMEOUT_MS
): Promise<boolean> {
  const existing = ackWaiters.get(batchId);
  if (existing) return existing.promise;
  let resolve!: (acknowledged: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  const timer = setTimeout(() => {
    ackWaiters.delete(batchId);
    resolve(false);
  }, timeoutMs);
  ackWaiters.set(batchId, { promise, resolve, timer });
  return promise;
}

/** UI 已把该批完整写入撤销栈；解除 SW 的补写等待。 */
export function resolveReuseClosedAck(batchId: string): void {
  const waiter = ackWaiters.get(batchId);
  if (!waiter) return;
  ackWaiters.delete(batchId);
  clearTimeout(waiter.timer);
  waiter.resolve(true);
}
