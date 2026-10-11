import { DuplicateIndex, KeeperPolicy } from '@/core/dup/DuplicateIndex';
import { canSafelyDiscardTab, type TabRecord } from '@/core/tab-types';

/**
 * 从当前标签集中选出某类目标的纯函数集合。
 *
 * 共同特征：每个判定都同时被「入口上显示的数量」与「按下后真实执行的目标」
 * 消费（底栏「可休眠 N 个」提示 / 确认弹窗「将关闭 N 个」文案 / 清理按钮徽章）。
 * 两处口径一旦分叉，表现就是「提示 5 个、按下说没有」这类直接失信于用户的
 * 不一致，故必须单点定义且落在 core（纯领域、零浏览器依赖）。
 */

/**
 * 重复清理计划：可关闭的标签 + 每个重复组保留的 keeper id。
 *
 * keepIds 供清理后的脉冲高亮使用，让「保留了谁」可见。
 * 固定空间绑定的标签豁免：用户显式保存的资产不参与自动清理。
 */
export function planDuplicateCleanup(
  index: DuplicateIndex,
  boundTabIds: readonly number[]
): { removable: TabRecord[]; keepIds: number[] } {
  const removable: TabRecord[] = [];
  const keepIds: number[] = [];
  // 绑定集转 Set 后查表：原实现对每个可清理标签做一次 O(n) 数组扫描，
  // 在大标签量 + 大量固定绑定时是渲染期的固定热点（本函数每帧都可能重算）。
  const bound = new Set(boundTabIds);
  for (const group of index.duplicates()) {
    const { keeper, removable: groupRemovable } = KeeperPolicy.default.select(group);
    keepIds.push(keeper.id);
    for (const tab of groupRemovable) {
      if (!bound.has(tab.id)) removable.push(tab);
    }
  }
  return { removable, keepIds };
}

/** 可安全休眠的标签（口径唯一来源）：非激活、未休眠、未被固定空间绑定、可安全休眠。 */
export function selectSleepableTabs(
  tabs: readonly TabRecord[],
  boundTabIds: readonly number[]
): TabRecord[] {
  const bound = new Set(boundTabIds);
  return tabs.filter(
    (tab) => !tab.active && !tab.discarded && !bound.has(tab.id) && canSafelyDiscardTab(tab)
  );
}

/**
 * 归档会真正关闭的标签（与 snapshotStore.archiveCurrentWindow 的可关闭口径同源：
 * 仅 http(s) 页面可入档，chrome:// 等内部页保留在原窗口）。
 */
export function selectArchivableTabs(tabs: readonly TabRecord[]): TabRecord[] {
  return tabs.filter(
    (tab) => typeof tab.id === 'number' && Boolean(tab.url) && /^https?:\/\//i.test(tab.url ?? '')
  );
}
