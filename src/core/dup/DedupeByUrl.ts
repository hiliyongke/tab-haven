import type { TabRecord } from '@/core/tab-types';

/**
 * 同 URL 保留者排序 —— **全应用唯一的 keeper 口径**（单一事实来源）。
 *
 * 每组保留「最近访问」的一个（lastAccessed 最新；平局：激活 > 固定 > 位置靠前 > id 大）。
 *
 * 消费方（两处必须同口径，UI 文案亦按此描述）：
 *  - 复用引擎（platform/reuse）：「同一网址只保留一个标签」开启时，新建标签导航到
 *    已存在网址，对「既有」集合选保留者，激活它并关闭其余副本；
 *  - 一键清理重复（core/dup/DuplicateIndex 的 KeeperPolicy）：每网址保留一个。
 *
 * 用户预期是「留最近用过的那个」，两处给出不同保留项即为缺陷（IA-3）——
 * 因此 KeeperPolicy 直接复用本函数，不再各自实现一套排序。
 *
 * 纯决策层，不触碰 browser.*。
 */

/**
 * 从一组同 URL 标签中选出保留者。
 * 「最新的一个」：lastAccessed 最大；平局依次比激活 / 固定 / 位置靠前 / id 大。
 */
export function rankForKeep(tabs: readonly TabRecord[]): TabRecord | undefined {
  return [...tabs].sort((a, b) => {
    const la = a.lastAccessed ?? 0;
    const lb = b.lastAccessed ?? 0;
    if (la !== lb) return lb - la;
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.index !== b.index) return a.index - b.index;
    return b.id - a.id;
  })[0];
}
