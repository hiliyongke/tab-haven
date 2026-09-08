import { browser } from 'wxt/browser';
import type { UndoTabRecord } from '@/core/schema/models';
import { NO_GROUP } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';

/**
 * 标签恢复引擎：把撤销记录（或未来的快照记录）重建为真实标签。
 *
 * 行为规格：
 *  - 按原位置顺序逐个恢复（加法语义：不关闭任何现有标签）；
 *  - 每个恢复 URL 先申请复用豁免（防止被自动复用合并）；
 *  - 恢复固定状态、静音状态；
 *  - 原分组存在则回原组；已删除则按组名重建。
 *
 */

/** 恢复结果：成功条数 + 失败条目（失败项需保留在撤销栈中供用户重试）。 */
export interface RestoreResult {
  /**
   * 本次真正新建的标签数。
   * 「目标窗口已打开同 URL」的按已恢复计入而不新建（用户意图是「这个页面要在」，
   * 重复新建一个才是制造垃圾），但批次内的同 URL 记录一律照数恢复 —— 撤销要还回
   * 用户实际关掉的数量。
   */
  count: number;
  /** 本次未恢复成功的记录（与入参顺序无关，按恢复顺序追加）。 */
  failed: UndoTabRecord[];
}

/** 取窗口内已打开页面的比较键集合（去重判定的唯一口径）。 */
async function openKeysInWindow(windowId: number): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const tabs = await browser.tabs.query({ windowId });
    for (const tab of tabs) {
      const key = webComparisonKey(tab.url ?? '', tab.pendingUrl ?? undefined);
      if (key) keys.add(key);
    }
  } catch {
    // 查询失败退化为「不去重」：宁可多开一个标签，也不能因为读不到状态而拒绝恢复。
  }
  return keys;
}

/**
 * 恢复一批撤销记录，返回成功数量与失败明细。
 *
 * 明细是「撤销可重试」的前提：只返回数量时，调用方无法判断哪些条目实际未恢复，
 * 只能整批丢弃或整批保留（前者丢数据、后者重复开标签）。
 */
export async function restoreTabRecordsDetailed(
  records: readonly UndoTabRecord[],
  windowId: number
): Promise<RestoreResult> {
  const restored = [...records].sort((a, b) => a.index - b.index);
  // 已打开去重：与快照恢复（snapshots.restoreSnapshot）同口径。
  // 不做这一步的话，用户手动重开某页后再撤销，必定收获一个重复标签。
  const openKeys = await openKeysInWindow(windowId);
  let count = 0;
  const failed: UndoTabRecord[] = [];

  for (const record of restored) {
    // 无 URL 的记录无法恢复：计入失败明细，避免整批重试时反复静默跳过。
    if (!record.url) {
      failed.push(record);
      continue;
    }

    const recordKey = webComparisonKey(record.url, undefined);
    if (recordKey !== null && openKeys.has(recordKey)) {
      // 目标窗口已有同 URL：视为已恢复，不再新建一个副本。
      count += 1;
      continue;
    }

    try {
      // 豁免复用：新恢复的标签不允许被重复复用引擎合并掉
      await grantReuseAllowance(windowId, record.url);

      const created = await browser.tabs.create({
        windowId,
        url: record.url,
        active: false,
        pinned: record.pinned,
        index: record.index
      });
      const createdId = created.id;
      // 拿不到 id 视为恢复失败（后续静音/分组都无从下手），计入明细而非静默跳过。
      if (createdId === undefined) {
        failed.push(record);
        continue;
      }

      if (record.muted) {
        await browser.tabs.update(createdId, { muted: true });
      }

      if (!record.pinned && record.groupId !== NO_GROUP) {
        try {
          await browser.tabs.group({ tabIds: [createdId], groupId: record.groupId });
        } catch {
          // 原组已删除：按名重建
          if (record.groupName) {
            try {
              const newGroupId = await browser.tabs.group({ tabIds: [createdId] });
              await browser.tabGroups.update(newGroupId, { title: record.groupName });
            } catch {
              // 组重建失败：保持未分组
            }
          }
        }
      }
      // 刻意**不**把新恢复的 URL 加回 openKeys：撤销是「把关掉的还回来」，
      // 同一批次里出现两条同 URL 是合法的（用户确实关了两个同 URL 标签）。
      // 若在此去重，撤销会静默少还标签，而 toast 仍报关闭时的条数。
      count += 1;
    } catch {
      // 单个标签恢复失败不影响同一批次中的其余标签；记录明细供调用方保留重试。
      failed.push(record);
    }
  }

  return { count, failed };
}

/** 兼容入口：只要成功数量（调用方无需失败明细时使用）。 */
export async function restoreTabRecords(
  records: readonly UndoTabRecord[],
  windowId: number
): Promise<number> {
  const result = await restoreTabRecordsDetailed(records, windowId);
  return result.count;
}
