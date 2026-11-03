import { autoDiscardBatchId, type AutoDiscardBatch } from '@/core/schema/models';
import { AUTO_DISCARD_BATCHES_LIMIT } from '@/platform/registry';
import { AUTO_DISCARD_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { autoDiscardRepository } from '@/platform/storage/repositories';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 自动休眠台账（多批次滚动保留）的唯一读写口径。
 * 三个写入方分处两个上下文（SW 闹钟追加/淘汰批次、面板「全部唤醒」摘除），都是整表读改写；
 * 锁外并发会 last-writer-wins（刚清除的批次被写回 / 刚写入的批次被覆盖丢失）。
 * 故 RMW 收口在本模块内的同一把锁里，消费方只表达意图，不自己 read-modify-write。
 */

/** 读取全部保留批次（无变更用途，如面板补提示）。 */
export function readAutoDiscardBatches(): Promise<AutoDiscardBatch[]> {
  return autoDiscardRepository.read();
}

/**
 * 跨页锁内 read → apply → write。
 * `apply` 返回 `null` 表示无变更，跳过写盘（淘汰扫描每分钟跑一次，无变更时不该产生写放大）。
 * 返回值为「磁盘上的台账是否与意图一致」：基线读取或写盘失败为 false，调用方不得据此宣称可撤销。
 */
export async function mutateAutoDiscardLedger(
  apply: (batches: AutoDiscardBatch[]) => AutoDiscardBatch[] | null
): Promise<boolean> {
  try {
    return await withCrossPageLock(AUTO_DISCARD_RMW_LOCK, async () => {
      const disk = await autoDiscardRepository.readStrict();
      const next = apply(disk);
      if (next === null) return true;
      return autoDiscardRepository.write(next);
    });
  } catch (error) {
    logDegraded('auto-discard', '自动休眠台账变更失败', error);
    return false;
  }
}

/**
 * 追加一轮休眠批次（按 at 滚动淘汰最旧的）。
 * 单槽位写入会让第二轮休眠抹掉第一轮，前一轮被冻结的标签就此失去「全部唤醒」出口。
 */
export function appendAutoDiscardBatch(
  tabIds: readonly number[],
  at: number,
  batchId?: string
): Promise<boolean> {
  if (tabIds.length === 0) return Promise.resolve(true);
  return mutateAutoDiscardLedger((batches) =>
    [...batches, { batchId, tabIds: [...tabIds], at, count: tabIds.length }]
      .sort((a, b) => b.at - a.at)
      .slice(0, AUTO_DISCARD_BATCHES_LIMIT)
  );
}

/** 按消息里的 batchId 精确读取完整台账；旧数据回退到派生 id。 */
export async function readAutoDiscardBatchById(
  batchId: string
): Promise<AutoDiscardBatch | undefined> {
  const batches = await readAutoDiscardBatches();
  return batches.find((batch) => autoDiscardBatchId(batch) === batchId);
}

/** 摘掉指定那一轮（「全部唤醒」后）：其余轮次仍处休眠，必须保留其唤醒出口。 */
export function removeAutoDiscardBatch(batchId: string): Promise<boolean> {
  return mutateAutoDiscardLedger((batches) => {
    const next = batches.filter((batch) => autoDiscardBatchId(batch) !== batchId);
    return next.length === batches.length ? null : next;
  });
}
