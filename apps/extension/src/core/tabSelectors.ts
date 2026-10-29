import { DuplicateIndex, KeeperPolicy } from '@/core/dup/DuplicateIndex';
import { canSafelyDiscardTab, type TabRecord } from '@/core/tab-types';
import { isHttpUrl } from '@/core/url/UrlInspector';

/**
 * 从当前标签集中选出某类目标的纯函数集合。
 *
 * 共同特征：每个判定同时被「入口显示的数量」与「按下后真实执行的目标」消费
 * （底栏「可休眠 N 个」/ 确认弹窗「将关闭 N 个」/ 清理按钮徽章）。
 * 两处口径分叉就表现为「提示 5 个、按下说没有」，故必须单点定义且落在 core。
 */

/**
 * 重复清理计划：可关闭的标签 + 每个重复组保留的 keeper id（供清理后脉冲高亮，让「保留了谁」可见）。
 * 固定空间绑定的标签豁免：用户显式保存的资产不参与自动清理。
 */
export function planDuplicateCleanup(
  index: DuplicateIndex,
  boundTabIds: readonly number[]
): { removable: TabRecord[]; keepIds: number[] } {
  const removable: TabRecord[] = [];
  const keepIds: number[] = [];
  // 绑定集转 Set 查表，避免对每个可清理标签做 O(n) 数组扫描（大量绑定时是渲染期热点）。
  const bound = new Set(boundTabIds);
  for (const group of index.duplicates()) {
    const { keeper, removable: groupRemovable } = KeeperPolicy.default.select(group);
    const candidates = groupRemovable.filter((tab) => !bound.has(tab.id));
    // 仅在该组真清掉了标签时才记 keeper：整组副本都被绑定时本次没关任何东西，
    // 高亮「保留者」会让用户以为刚发生了一次清理。
    if (candidates.length === 0 || keeper === undefined) continue;
    keepIds.push(keeper.id);
    removable.push(...candidates);
  }
  return { removable, keepIds };
}

/** 可安全休眠的标签（口径唯一来源）：后台、未休眠、未被固定空间绑定、可安全休眠。 */
export function selectSleepableTabs(
  tabs: readonly TabRecord[],
  boundTabIds: readonly number[]
): TabRecord[] {
  const bound = new Set(boundTabIds);
  return tabs.filter(
    (tab) => !tab.active && !tab.discarded && !bound.has(tab.id) && canSafelyDiscardTab(tab)
  );
}

/** 归档会真正关闭的标签（与 snapshotStore.archiveCurrentWindow 同源：仅 http(s) 可入档）。 */
export function selectArchivableTabs(tabs: readonly TabRecord[]): TabRecord[] {
  return tabs.filter((tab) => typeof tab.id === 'number' && isHttpUrl(tab.url));
}
