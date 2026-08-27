import { browser } from 'wxt/browser';
import type { UndoTabRecord } from '@/core/schema/models';
import { NO_GROUP } from '@/core/tab-types';
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

export async function restoreTabRecords(
  records: readonly UndoTabRecord[],
  windowId: number
): Promise<number> {
  const restored = [...records].sort((a, b) => a.index - b.index);
  let count = 0;

  for (const record of restored) {
    if (!record.url) continue;

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
      if (createdId === undefined) continue;

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
      count += 1;
    } catch {
      // 单个标签恢复失败不影响同一批次中的其余标签
    }
  }

  return count;
}
