import { browser } from 'wxt/browser';
import type { AutoGroupPlan } from '@/core/group/AutoGrouping';
import { planAutoGroupDomainCorrections } from '@/core/group/AutoGrouping';
import type { TemporarySection } from '@/core/site/Sections';
import { NO_GROUP } from '@/core/tab-types';
import { createSerialChain } from '@/core/util/concurrency';
import { groupExists, removeGroup, updateGroupMeta } from '@/platform/tabs';
import { autoGroupsRepository } from '@/platform/storage/repositories';
import { AUTO_GROUPS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 自动分组执行器：把 plan 落成浏览器原生 tabGroups。幂等性由决策层保证（创建后标签获得
 * groupId，下一轮不再产出 plan）；单组失败静默跳过，标签保持未分组，下轮快照重试。
 * 生命周期：创建成功的组 id 持久化记录；关闭开关时由 disbandAutoGroups 解散记录的组。
 */

/**
 * 同上下文串行化链（自动同步 / 快速整理 / 解散共用）。调用方是「标签快照 → effect」的
 * 响应式路径，而建组本身会触发标签事件，使 effect 在上一轮 await 结束前再次进入。两次执行
 * 若交错会为同一批标签重复建组——后建的组把标签移走，先建的组变空被回收，于是先建组的
 * updateGroupMeta 报 No group with id。串行化之后，过期的计划会在 filterStalePlans 处被过滤掉。
 */
const opChain = createSerialChain();

/** 把操作追加到串行链：前序失败不阻断后续（各自内部已有错误处理）。 */
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  return opChain.enqueue(operation);
}

/**
 * 用浏览器真实状态过滤过期计划。plan 由标签快照派生，而快照收敛滞后于真实状态：
 * tabs.group() 自身触发的事件里 groupId 可能仍是旧值，直接执行过期 plan 会重复建组。
 * 执行前用一次 query 对齐真实分组状态：已入组/已关闭的标签剔除。查询失败不阻断（按原计划执行）。
 */
async function filterStalePlans(
  plans: readonly AutoGroupPlan[]
): Promise<{ plan: AutoGroupPlan; tabIds: number[] }[]> {
  let live: Map<number, number> | null = null;
  try {
    const tabs = await browser.tabs.query({});
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
        // 吸收模式：把同站点未分组标签移入既有原生组。目标组可能在决策后被解散：跳过本次，
        // 下一轮快照会把这批标签重新决策为「新建组」。组非本功能新建，不计入 createdIds。
        // 查询失败同样跳过：拿不到确认就写入会把标签塞进一个可能已不存在的组。
        if ((await groupExists(plan.absorbIntoGroupId)) !== 'exists') continue;
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
    // 跨页锁内 RMW：两个窗口的侧边栏可并发 syncAutoGroups，锁外交错丢 id → 关闭开关时漏解散（孤儿组）。
    const recorded = await withCrossPageLock(AUTO_GROUPS_RMW_LOCK, async () => {
      let existing: number[];
      try {
        existing = await autoGroupsRepository.readStrict();
      } catch (error) {
        logDegraded('auto-group', '自动分组记账基线读取失败，本次创建将回滚', error);
        return false;
      }
      return autoGroupsRepository.write([...new Set([...existing, ...createdIds])]);
    });
    if (recorded === false) {
      // 记账失败（读取故障/配额）：组已创建但记录缺失，关闭开关时该组永不被解散。此时立即解散
      // 刚创建的组并留痕，宁可「自动分组未生效」也不留下无法回收的原生组。
      logDegraded('auto-group', '自动分组记账失败，已回滚本次创建的组（避免孤儿组）', createdIds);
      for (const groupId of createdIds) {
        await removeGroup(groupId);
      }
      return 0;
    }
  }
  return createdIds.length;
}

/** 按计划同步原生标签组（自动分组开关的落地动作）：串行执行，返回新建的组数。空计划直接返回 0。 */
export function syncAutoGroups(plans: readonly AutoGroupPlan[]): Promise<number> {
  if (plans.length === 0) return Promise.resolve(0);
  return enqueue(() => runSyncAutoGroups(plans));
}

/**
 * 快速整理执行：先打散临时区现有原生组（空组由浏览器自动回收），再按计划创建新组。
 * 返回成功创建/整理的组数。固定区域不在此集合内，天然不受影响。
 *
 * 与 syncAutoGroups 不同，不做 filterStalePlans：本操作的语义就是「忽略当前分组状态全部
 * 重新聚合」，按真实状态过滤会把已入组标签剔除，恰好破坏重新整理的语义。
 *
 * 快速整理创建的组有意不记入 autoGroupsRepository：那是「自动分组开关」关闭时要解散的记账，
 * 而快速整理是用户显式触发的手动操作——若记入，关闭开关会把用户亲手整理的组一并解散。
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

/**
 * 快速整理：先打散临时区的既有原生组，再按计划重新建组。返回整理出的组数。
 * 与 syncAutoGroups 不同，这里不按当前分组状态过滤计划——语义就是全量重新聚合。
 */
export function regroupTempArea(
  ungroupTabIds: readonly number[],
  plans: readonly AutoGroupPlan[]
): Promise<number> {
  return enqueue(() => runRegroupTempArea(ungroupTabIds, plans));
}

/**
 * 解散本功能创建的全部自动组（设置开关关闭时调用）。标签回到未分组、组被删除、记录清空；
 * 已不存在的组静默跳过。返回实际解散的组数。
 */
async function runDisbandAutoGroups(): Promise<number> {
  // 与 syncAutoGroups 的记账写同锁：解散进行中若并发创建了新组，锁外 read→write 会把新 id
  // 覆盖丢失（组已建、记录没了 → 孤儿组）。
  return withCrossPageLock(AUTO_GROUPS_RMW_LOCK, async () => {
    let ids: number[];
    try {
      ids = await autoGroupsRepository.readStrict();
    } catch (error) {
      logDegraded('auto-group', '解散自动组前读取记账失败，本次未改动任何组', error);
      return 0;
    }
    if (ids.length === 0) return 0;
    let count = 0;
    const failed: number[] = [];
    for (const groupId of ids) {
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
      // 落盘失败时按「未解散」上报：磁盘上仍记录全部 id，下次关闭开关时会重试。
      logDegraded('auto-group', 'disbandAutoGroups 记录回写失败，本次解散结果未持久化');
      return 0;
    }
    return count;
  });
}

/** 解散本功能创建的全部自动组（关闭自动分组开关时调用），返回实际解散的组数。 */
export function disbandAutoGroups(): Promise<number> {
  return enqueue(() => runDisbandAutoGroups());
}

/**
 * 自动组「域名漂移」校正：把不属于组标题所指站点的成员移出自动组，返回移出的标签数。
 * Chrome 会把「从组内标签点击链接打开的新标签」自动加入同一个组，这类标签一出生就带 groupId，
 * 而自动分组只处理未分组标签，于是跨域链接永久滞留在 opener 的域名组里。
 * 移出后由 ungroup 的 groupId 变更事件驱动下一轮快照重新聚合。只处理 autoGroupsRepository
 * 记录的组（本功能创建的），不触碰用户手动建的组。
 */
async function runReconcileAutoGroupDomains(
  sections: readonly TemporarySection[]
): Promise<number> {
  const autoGroupIds = new Set(await autoGroupsRepository.read());
  const corrections = planAutoGroupDomainCorrections(sections, autoGroupIds);
  let moved = 0;
  for (const correction of corrections) {
    try {
      await browser.tabs.ungroup([...correction.tabIds] as [number, ...number[]]);
      moved += correction.tabIds.length;
    } catch (error) {
      // 单组失败不影响其余组：成员可能已被关闭或用户手动移出，下一轮快照重新判定
      logDegraded('auto-group', '校正自动组的异域名成员失败', error);
    }
  }
  return moved;
}

/**
 * 自动组「域名漂移」校正。与 syncAutoGroups 共用串行链：建组与移出交叠会让同一标签在两轮里
 * 被反复搬动。无 native 分区时直接返回：这条响应式路径不该为此每轮多付一次 storage 读取。
 */
export function reconcileAutoGroupDomains(sections: readonly TemporarySection[]): Promise<number> {
  if (!sections.some((section) => section.kind === 'native')) return Promise.resolve(0);
  return enqueue(() => runReconcileAutoGroupDomains(sections));
}
