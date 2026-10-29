import { browser } from 'wxt/browser';
import type { UndoTabRecord } from '@/core/schema/models';
import { NO_GROUP } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '@/core/util/concurrency';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { logDegraded } from '@/platform/diagnostics';
import { tabGroups } from '@/platform/tabGroups';

/**
 * 标签恢复引擎：把撤销记录（或未来的快照记录）重建为真实标签。
 * 行为：按原位置顺序逐个恢复（加法语义：不关闭任何现有标签）；每个恢复 URL 先申请复用豁免；
 * 恢复固定/静音状态；原分组存在则回原组，已删除则按组名重建。
 */

/** 恢复结果：成功条数 + 失败条目（失败项需保留在撤销栈中供用户重试）。 */
interface RestoreResult {
  /**
   * 本次真正新建的标签数。「目标窗口已打开同 URL」的按已恢复计入而不新建，但批次内的同 URL
   * 记录一律照数恢复 —— 撤销要还回用户实际关掉的数量。
   */
  count: number;
  /** 本次未恢复成功的记录（按恢复顺序追加）。 */
  failed: UndoTabRecord[];
  /**
   * 「目标窗口已打开同 URL」而未真正新建的记录。它们对撤销是成功（页面确实在），但对重做
   * 不是：重做按 URL 反查并关闭，若压进重做栈，被关掉的是用户本来就开着、与本次撤销无关的
   * 那个标签。调用方入重做栈时必须排除这批。
   */
  skippedAlreadyOpen: UndoTabRecord[];
  /** 查询目标窗口已打开页面失败，本次按「不去重」继续（宁可多建也不拒绝恢复）。置起即意味着
   * 可能多建了副本，由调用方告知用户，不阻断流程。 */
  degraded: boolean;
}

/**
 * 取窗口内已打开页面的比较键集合（去重判定的唯一口径）。查询失败返回 degraded: true：
 * 按「不去重」继续（宁可多开一个标签），但必须让调用方知道本次可能多建了副本。
 */
async function openKeysInWindow(
  windowId: number
): Promise<{ keys: Set<string>; degraded: boolean }> {
  const keys = new Set<string>();
  try {
    const tabs = await browser.tabs.query({ windowId });
    for (const tab of tabs) {
      const key = webComparisonKey(tab.url ?? '', tab.pendingUrl ?? undefined);
      if (key) keys.add(key);
    }
  } catch (error) {
    // 与 snapshots.restoreSnapshot 同口径：去重查询失败会走「不去重」分支，本轮可能多建副本。
    logDegraded('undo', `查询窗口 ${windowId} 已打开页面失败，按无重复恢复（可能多建副本）`, error);
    return { keys, degraded: true };
  }
  return { keys, degraded: false };
}

/** 单条记录的恢复结局：新建成功 / 已存在未新建 / 失败。 */
type RestoreOutcome = 'created' | 'skipped' | 'failed';

/**
 * 恢复一批撤销记录，返回成功数量与失败明细。明细是「撤销可重试」的前提：只返回数量时，
 * 调用方无法判断哪些条目实际未恢复，只能整批丢弃或整批保留。
 */
export async function restoreTabRecordsDetailed(
  records: readonly UndoTabRecord[],
  windowId: number
): Promise<RestoreResult> {
  const restored = [...records].sort((a, b) => a.index - b.index);
  // 已打开去重：与快照恢复同口径。不做这一步，用户手动重开某页后再撤销，必定收获一个重复标签。
  const { keys: openKeys, degraded } = await openKeysInWindow(windowId);
  // 豁免发放未获确认的聚合标志：并发任务内改不到外层的 degraded，先记账后合并。不发这个标志
  // 的话，豁免没发下去（新标签会被复用引擎合并）而界面仍报「已恢复 N 个」。
  let allowanceDegraded = false;

  // 有限并发而非严格串行：每条记录都要走「发放豁免 → create → 静音/分组」三段 await，
  // 严格串行下 100 条就是 300 次串行往返。结果按输入顺序收集，顺序即用户期望的落位顺序。
  const outcomes = await mapWithConcurrency(
    restored,
    DEFAULT_CONCURRENCY,
    async (record): Promise<RestoreOutcome> => {
      // 无 URL 的记录无法恢复：计入失败明细，避免整批重试时反复静默跳过。
      if (!record.url) return 'failed';

      const recordKey = webComparisonKey(record.url, undefined);
      if (recordKey !== null && openKeys.has(recordKey)) {
        // 目标窗口已有同 URL：视为已恢复，不再新建副本。必须与「新建成功」区分开：重做会按 URL
        // 反查并关闭，把这条算作新建会让重做关掉用户本来就开着、与本次撤销无关的那个标签。
        return 'skipped';
      }

      try {
        // 豁免复用：新恢复的标签不允许被复用引擎合并。未获确认时新标签可能被合并，本次「已恢复」
        // 是假的，必须计入 degraded。
        const granted = await grantReuseAllowance(windowId, record.url);
        if (!granted) allowanceDegraded = true;

        const created = await browser.tabs.create({
          windowId,
          url: record.url,
          active: false,
          pinned: record.pinned,
          index: record.index
        });
        const createdId = created.id;
        // 拿不到 id 视为恢复失败（后续静音/分组都无从下手），计入明细而非静默跳过。
        if (createdId === undefined) return 'failed';

        if (record.muted) {
          await browser.tabs.update(createdId, { muted: true });
        }

        if (!record.pinned && record.groupId !== NO_GROUP) {
          // 旧 groupId 在浏览器重启后可能已被复用为无关组：入组前校验组标题，与记录不符即走
          // 按名重建——否则标签会误入他组。（批次未记录 groupName 时无从校验，保持原样直接尝试入组。）
          let reuseGroupId = true;
          if (record.groupName) {
            try {
              const existing = await tabGroups.get(record.groupId);
              reuseGroupId = existing.title === record.groupName;
            } catch (error) {
              // 「组不存在」是预期内（重启后旧组已消失），但其它失败必须可观测。
              logDegraded('undo', `校验原组 ${record.groupId} 失败，改按组名重建分组`, error, {
                quiet: true
              });
              reuseGroupId = false;
            }
          }
          if (reuseGroupId) {
            try {
              await browser.tabs.group({ tabIds: [createdId], groupId: record.groupId });
            } catch (error) {
              logDegraded('undo', `标签 ${createdId} 未能回到原组 ${record.groupId}`, error);
              reuseGroupId = false;
            }
          }
          if (!reuseGroupId && record.groupName) {
            // 原组已删除或 id 被复用：按名重建
            try {
              const newGroupId = await browser.tabs.group({ tabIds: [createdId] });
              await tabGroups.update(newGroupId, { title: record.groupName });
            } catch (error) {
              // 组重建失败：保持未分组（不阻断恢复），但必须留痕。
              logDegraded('undo', `按名重建分组「${record.groupName}」失败，标签保持未分组`, error);
            }
          }
        }
        // 刻意不把新恢复的 URL 加回 openKeys：撤销是「把关掉的还回来」，同一批次里出现两条同
        // URL 是合法的。若在此去重，撤销会静默少还标签，而 toast 仍报关闭时的条数。
        return 'created';
      } catch (error) {
        // 单个标签恢复失败不影响同一批次中的其余标签；记录明细供调用方保留重试。
        logDegraded('undo', `恢复标签失败：${record.url ?? '(无 URL)'}`, error);
        return 'failed';
      }
    }
  );

  let count = 0;
  const failed: UndoTabRecord[] = [];
  const skippedAlreadyOpen: UndoTabRecord[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    const record = restored[index]!;
    if (outcome === 'failed') failed.push(record);
    else if (outcome === 'skipped') skippedAlreadyOpen.push(record);
    // 'created' 与 'skipped' 都算「这份页面此刻在窗口里」，故 count 一并计入。
    if (outcome !== 'failed') count += 1;
  }

  return { count, failed, skippedAlreadyOpen, degraded: degraded || allowanceDegraded };
}
