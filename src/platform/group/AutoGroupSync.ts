import { browser } from 'wxt/browser';
import type { AutoGroupPlan } from '@/core/group/AutoGrouping';
import { removeGroup, updateGroupMeta } from '@/platform/tabs';
import { autoGroupsRepository } from '@/platform/storage/repositories';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 自动分组执行器：把 plan 落成浏览器原生 tabGroups。
 *
 * 幂等性由决策层保证（创建后标签获得 groupId，下一轮不再产出 plan）；
 * 单组失败静默跳过，不影响其余组（标签保持未分组，下轮快照重试）。
 *
 * 生命周期（与设置开关联动）：
 *  - 创建成功的组 id 持久化记录（tabhaven.auto-groups.v1）；
 *  - 关闭开关时由 disbandAutoGroups 解散记录的组（标签回到未分组）。
 */

export async function syncAutoGroups(plans: readonly AutoGroupPlan[]): Promise<number> {
  const createdIds: number[] = [];
  for (const plan of plans) {
    try {
      const tabIds = [...plan.tabIds] as [number, ...number[]];
      const groupId = await browser.tabs.group({ tabIds });
      if (groupId !== undefined) {
        await updateGroupMeta(groupId, plan.title, plan.color);
        createdIds.push(groupId);
      }
    } catch (error) {
      logDegraded('auto-group', 'syncAutoGroups 单组创建失败', error);
      // 单组失败不影响其他组；标签保持未分组，下轮快照重新尝试
    }
  }
  if (createdIds.length > 0) {
    const existing = await autoGroupsRepository.read();
    await autoGroupsRepository.write([...new Set([...existing, ...createdIds])]);
  }
  return createdIds.length;
}

/**
 * 快速整理执行：先打散临时区现有原生组（tabs.ungroup，空组由浏览器自动回收），
 * 再按计划创建新组。返回成功创建/整理的组数。
 * 固定区域（浏览器置顶/顶部固定磁贴/固定空间绑定）不在此集合内，天然不受影响。
 */
export async function regroupTempArea(
  ungroupTabIds: readonly number[],
  plans: readonly AutoGroupPlan[]
): Promise<number> {
  if (ungroupTabIds.length > 0) {
    try {
      await browser.tabs.ungroup([...ungroupTabIds] as [number, ...number[]]);
    } catch (error) {
      logDegraded('auto-group', 'regroupTempArea 打散现有组失败', error);
      // 部分标签可能已不在组内，静默忽略
    }
  }
  let count = 0;
  for (const plan of plans) {
    try {
      const tabIds = [...plan.tabIds] as [number, ...number[]];
      const groupId = await browser.tabs.group({ tabIds });
      if (groupId !== undefined) {
        await updateGroupMeta(groupId, plan.title, plan.color);
        count += 1;
      }
    } catch (error) {
      logDegraded('auto-group', 'regroupTempArea 单组创建失败', error);
      // 单组失败静默跳过，标签保持未分组
    }
  }
  return count;
}

/**
 * 解散本功能创建的全部自动组（设置开关关闭时调用）。
 * 标签回到未分组、组被删除、记录清空；已不存在的组（用户手动解散）静默跳过。
 * 返回实际解散的组数。
 */
export async function disbandAutoGroups(): Promise<number> {
  const ids = await autoGroupsRepository.read();
  if (ids.length === 0) return 0;
  let count = 0;
  const failed: number[] = [];
  for (const groupId of ids) {
    // removeGroup 以返回值区分「已解散 / 已不存在 / 真实失败」，不再依赖抛异常：
    const outcome = await removeGroup(groupId);
    if (outcome === 'failed') {
      // 真实失败：保留 id 供下次重试，避免「组未解散、记录已清」的孤儿组。
      failed.push(groupId);
    } else {
      // 'removed' 与 'missing' 均表示目标已达成，清理记录（missing 不再重试）。
      count += 1;
    }
  }
  await autoGroupsRepository.write(failed);
  return count;
}
