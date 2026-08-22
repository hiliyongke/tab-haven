import type { TabRecord } from '@/core/tab-types';

/**
 * 分屏组竖线角色：同一 splitViewId 的「连续」标签段 → first/middle/last。
 *
 *  - 段长 ≥2：组首 first、组尾 last、中间 middle；
 *  - 段长 1：给 first，单标签也可能是分屏成员，仍应有指示；
 *  - 被 recency 排序打散（不连续）时不画线。
 */
export type SplitGroupRole = 'first' | 'middle' | 'last';

export function computeSplitGroupRoles(tabs: readonly TabRecord[]): Map<number, SplitGroupRole> {
  const roles = new Map<number, SplitGroupRole>();
  let i = 0;
  while (i < tabs.length) {
    const groupId = tabs[i]?.splitViewId;
    if (groupId === undefined) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < tabs.length && tabs[j]?.splitViewId === groupId) j += 1;
    const len = j - i;
    roles.set(tabs[i]!.id, 'first');
    for (let k = i + 1; k < j - 1; k += 1) roles.set(tabs[k]!.id, 'middle');
    if (len >= 2) roles.set(tabs[j - 1]!.id, 'last');
    i = j;
  }
  return roles;
}
