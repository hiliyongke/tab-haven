import { browser } from 'wxt/browser';
import type { AutoGroupPlan } from '@/core/group/AutoGrouping';
import { NO_GROUP } from '@/core/tab-types';
import { groupExists, removeGroup, updateGroupMeta } from '@/platform/tabs';
import { autoGroupsRepository } from '@/platform/storage/repositories';
import { AUTO_GROUPS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 自动分组执行器：把 plan 落成浏览器原生 tabGroups。
 *
 * 幂等性由决策层保证（创建后标签获得 groupId，下一轮不再产出 plan）；
 * 单组失败静默跳过，不影响其余组（标签保持未分组，下轮快照重试）。
 *
 * 生命周期（与设置开关联动）：
 *  - 创建成功的组 id 持久化记录（tabs.auto-groups.v1）；
 *  - 关闭开关时由 disbandAutoGroups 解散记录的组（标签回到未分组）。
 */

/**
 * 同上下文串行化链（自动同步 / 快速整理 / 解散共用）。
 *
 * 为什么必须串行：调用方是「标签快照 → effect」的响应式路径，而**建组本身
 * 会触发标签事件**，使 effect 在上一轮 await 结束前再次进入。两次执行若交错，
 * 会为同一批标签重复建组 —— 后建的组把标签移走，先建的组变空被浏览器回收，
 * 于是先建组的 updateGroupMeta 报 `No group with id`（用户会在扩展管理页
 * 的「错误」面板看到一屏报错）。串行化之后，后到的过期计划会在
 * filterStalePlans 处被真实状态过滤掉。
 */
let opChain: Promise<unknown> = Promise.resolve();

/** 把操作追加到串行链：前序失败不阻断后续（各自内部已有错误处理）。 */
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = opChain.then(operation, operation);
  opChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * 用浏览器真实状态过滤过期计划。
 *
 * plan 由侧边栏的标签快照派生，而快照收敛滞后于真实状态：`tabs.group()` 自身
 * 触发的事件会更新快照，但其中的 `groupId` 可能仍是旧值。直接执行过期 plan
 * 会重复建组（见 opChain 注释）。执行前用一次 query 对齐真实分组状态：
 * 已入组的标签从计划中剔除；标签已关闭时同样剔除，顺带避免 `tabs.group`
 * 报「No tab with id」。查询失败时不阻断（按原计划执行，由下游 catch 兜底）。
 */
async function filterStalePlans(
  plans: readonly AutoGroupPlan[]
): Promise<{ plan: AutoGroupPlan; tabIds: number[] }[]> {
  let live: Map<number, number> | null = null;
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    live = new Map(
      tabs
        .filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined)
        .map((tab) => [tab.id, tab.groupId ?? NO_GROUP])
    );
  } catch (error) {
    logDegraded('auto-group', '对齐标签真实分组状态失败，按快照计划执行', error);
  }

  const fresh: { plan: AutoGroupPlan; tabIds: number[] }[] = [];
  for (const plan of plans) {
    const tabIds = live ? plan.tabIds.filter((id) => live.get(id) === NO_GROUP) : plan.tabIds;
    // 全部已入组（或已关闭）→ 计划过期，跳过
    if (tabIds.length === 0) continue;
    fresh.push({ plan, tabIds });
  }
  return fresh;
}

async function runSyncAutoGroups(plans: readonly AutoGroupPlan[]): Promise<number> {
  const createdIds: number[] = [];
  for (const { plan, tabIds: freshIds } of await filterStalePlans(plans)) {
    try {
      const tabIds = [...freshIds] as [number, ...number[]];
      if (plan.absorbIntoGroupId !== undefined) {
        // 吸收模式：把同站点未分组标签移入既有原生组（tabs.group 携带 groupId 即移动）。
        // 目标组可能在决策后被解散（用户手动解散 / 并发整理）：跳过本次，
        // 下一轮快照会把这批标签重新决策为「新建组」，不会永久漏掉。
        // 组非本功能新建，不计入 createdIds——关闭开关时的解散范围保持不变。
        if (!(await groupExists(plan.absorbIntoGroupId))) continue;
        await browser.tabs.group({ tabIds, groupId: plan.absorbIntoGroupId });
        continue;
      }
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
    // 跨页锁内 RMW：两个窗口的侧边栏可并发 syncAutoGroups，
    // 锁外交错丢 id → 关闭开关时 disbandAutoGroups 漏解散（孤儿组）。
    const recorded = await withCrossPageLock(AUTO_GROUPS_RMW_LOCK, async () => {
      const existing = await autoGroupsRepository.read();
      return autoGroupsRepository.write([...new Set([...existing, ...createdIds])]);
    });
    if (recorded === false) {
      // 记账写入失败（配额）：组已创建但记录缺失，关闭开关时该组永不被解散，
      // 成为孤儿组。此时立即解散刚创建的组并留痕，宁可「自动分组未生效」
      // 也不留下无法回收的原生组。
      logDegraded(
        'auto-group',
        '自动分组记账写入失败，已回滚本次创建的组（避免孤儿组）',
        createdIds
      );
      for (const groupId of createdIds) {
        await removeGroup(groupId);
      }
      return 0;
    }
  }
  return createdIds.length;
}

export function syncAutoGroups(plans: readonly AutoGroupPlan[]): Promise<number> {
  if (plans.length === 0) return Promise.resolve(0);
  return enqueue(() => runSyncAutoGroups(plans));
}

/**
 * 快速整理执行：先打散临时区现有原生组（tabs.ungroup，空组由浏览器自动回收），
 * 再按计划创建新组。返回成功创建/整理的组数。
 * 固定区域（浏览器置顶/顶部固定磁贴/固定空间绑定）不在此集合内，天然不受影响。
 *
 * 与 syncAutoGroups 不同，**不做 filterStalePlans**：本操作的语义就是
 * 「忽略当前分组状态全部重新聚合」（planRegroup 已把标签视为未分组重新派生），
 * 按真实状态过滤会把已入组标签剔除，恰好破坏重新整理的语义。
 */
async function runRegroupTempArea(
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

export function regroupTempArea(
  ungroupTabIds: readonly number[],
  plans: readonly AutoGroupPlan[]
): Promise<number> {
  return enqueue(() => runRegroupTempArea(ungroupTabIds, plans));
}

/**
 * 解散本功能创建的全部自动组（设置开关关闭时调用）。
 * 标签回到未分组、组被删除、记录清空；已不存在的组（用户手动解散）静默跳过。
 * 返回实际解散的组数。
 */
async function runDisbandAutoGroups(): Promise<number> {
  // 与 syncAutoGroups 的记账写同锁：解散进行中若并发创建了新组，
  // 锁外 read→write 会把新 id 覆盖丢失（组已建、记录没了 → 孤儿组）。
  return withCrossPageLock(AUTO_GROUPS_RMW_LOCK, async () => {
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
    const ok = await autoGroupsRepository.write(failed);
    if (ok === false) {
      // 落盘失败时按「未解散」上报：磁盘上仍记录全部 id，下次关闭开关时会重试，
      // 否则内存认知（已解散 count 个）与磁盘记录分叉。
      logDegraded('auto-group', 'disbandAutoGroups 记录回写失败，本次解散结果未持久化');
      return 0;
    }
    return count;
  });
}

export function disbandAutoGroups(): Promise<number> {
  return enqueue(() => runDisbandAutoGroups());
}
