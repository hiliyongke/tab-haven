import type { AutoDiscardBatch } from '@/core/schema/models';
import { AUTO_DISCARD_BATCHES_LIMIT } from '@/platform/registry';
import { AUTO_DISCARD_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { autoDiscardRepository } from '@/platform/storage/repositories';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 自动休眠台账（多批次滚动保留）的唯一读写口径。
 *
 * 台账有三个写入方，分处两个上下文：
 *  1. SW 闹钟（`platform/background/autoDiscard.ts`）：追加新一轮批次 + 淘汰失效批次；
 *  2. 面板「全部唤醒」（sidepanel）：摘掉刚被唤醒的那一轮。
 * 三者都是「整表读 → 改 → 整表写」，锁外并发会 last-writer-wins —— 表现为
 * 「刚清除的批次被 SW 写回（唤醒入口点了没反应）」或「刚写入的批次被面板覆盖
 * 丢失（该轮自动休眠没有撤销出口）」。因此 RMW 必须收口在本模块内的同一把锁里，
 * 消费方只表达意图，不自己 read-modify-write。
 */

/** 同一批标签（tabIds 内容与顺序一致）：按内容比对而非整表清空，避免抹掉其它轮次。 */
function sameTabIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** 读取全部保留批次（无变更用途，如面板补提示）。 */
export function readAutoDiscardBatches(): Promise<AutoDiscardBatch[]> {
  return autoDiscardRepository.read();
}

/**
 * 跨页锁内 read → apply → write。
 *
 * `apply` 返回 `null` 表示无变更，跳过写盘（淘汰扫描每分钟跑一次，
 * 无变更时不该产生写放大）。返回值语义为「磁盘上的台账是否与意图一致」：
 * 写盘失败（配额/不可用）为 false，调用方不得据此宣称可撤销。
 */
export async function mutateAutoDiscardLedger(
  apply: (batches: AutoDiscardBatch[]) => AutoDiscardBatch[] | null
): Promise<boolean> {
  try {
    return await withCrossPageLock(AUTO_DISCARD_RMW_LOCK, async () => {
      const disk = await autoDiscardRepository.read();
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
 *
 * 单槽位写入会让第二轮休眠抹掉第一轮 —— 第一轮冻结的标签还没被唤醒，
 * 「全部唤醒」于是只兜得住最近一轮，更早的批次永久失去出口。
 */
export function appendAutoDiscardBatch(tabIds: readonly number[], at: number): Promise<boolean> {
  if (tabIds.length === 0) return Promise.resolve(true);
  return mutateAutoDiscardLedger((batches) =>
    [...batches, { tabIds: [...tabIds], at, count: tabIds.length }]
      .sort((a, b) => b.at - a.at)
      .slice(0, AUTO_DISCARD_BATCHES_LIMIT)
  );
}

/** 摘掉指定那一轮（「全部唤醒」后）：其余轮次仍处休眠，必须保留其唤醒出口。 */
export function removeAutoDiscardBatch(tabIds: readonly number[]): Promise<boolean> {
  return mutateAutoDiscardLedger((batches) => {
    const next = batches.filter((batch) => !sameTabIds(batch.tabIds, tabIds));
    return next.length === batches.length ? null : next;
  });
}
