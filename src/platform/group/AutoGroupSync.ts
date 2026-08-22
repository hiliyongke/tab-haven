import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { AutoGroupPlan } from '@/core/group/AutoGrouping';
import { removeGroup, updateGroupMeta } from '@/platform/tabs';
import { DataRepository } from '@/platform/storage/DataRepository';

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

/** 本功能创建的组 id 记录（用于关闭开关时解散）。 */
const autoGroupsRepository = new DataRepository<number[]>(
  'tabhaven.auto-groups.v1',
  z.array(z.number()),
  []
);

export async function syncAutoGroups(plans: readonly AutoGroupPlan[]): Promise<void> {
  const createdIds: number[] = [];
  for (const plan of plans) {
    try {
      const tabIds = [...plan.tabIds] as [number, ...number[]];
      const groupId = await browser.tabs.group({ tabIds });
      if (groupId !== undefined) {
        await updateGroupMeta(groupId, plan.title, plan.color);
        createdIds.push(groupId);
      }
    } catch {
      // 单组失败不影响其他组；标签保持未分组，下轮快照重新尝试
    }
  }
  if (createdIds.length > 0) {
    const existing = await autoGroupsRepository.read();
    await autoGroupsRepository.write([...new Set([...existing, ...createdIds])]);
  }
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
  for (const groupId of ids) {
    try {
      await removeGroup(groupId);
      count += 1;
    } catch {
      // 组已不存在（用户手动解散/浏览器清理），跳过
    }
  }
  await autoGroupsRepository.write([]);
  return count;
}
