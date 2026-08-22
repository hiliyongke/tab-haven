import type { TabRecord } from '@/core/tab-types';

/**
 * 重复标签检测与清理（从 Tabstead sidepanel.js / background.js 移植，语义不变）。
 * 全部为纯函数：输入标签数组，输出派生结果，不做任何 chrome API 调用。
 */

/** 按完整 URL 精确计数（含 pinned）。 */
export function duplicateUrlCounts(tabs: readonly TabRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    if (!tab.url) continue;
    counts.set(tab.url, (counts.get(tab.url) || 0) + 1);
  }
  return counts;
}

/** 将重复（同 URL ≥ 2）的标签按 URL 分组。 */
export function duplicateGroups(tabs: readonly TabRecord[]): TabRecord[][] {
  const groups = new Map<string, TabRecord[]>();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const group = groups.get(tab.url) || [];
    group.push(tab);
    groups.set(tab.url, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * 可清理的重复标签：每组的 keeper 保留，其余非 pinned 的为可清理。
 * keeper 优先级（基线策略）：当前激活 > 已固定 > 最早打开（数组序即 index 序）。
 */
export function removableDuplicates(tabs: readonly TabRecord[]): TabRecord[] {
  return duplicateGroups(tabs).flatMap((group) => {
    const keeper = group.find((tab) => tab.active) || group.find((tab) => tab.pinned) || group[0];
    return group.filter((tab) => tab !== keeper && !tab.pinned);
  });
}

/**
 * 复用目标偏好排序（background 复用引擎用）：
 * active > pinned > index 小 > id 小。
 */
export function preferredExistingTab(candidates: readonly TabRecord[]): TabRecord | undefined {
  return [...candidates].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.index !== b.index) return a.index - b.index;
    return a.id - b.id;
  })[0];
}

/**
 * 在窗口内寻找复用目标（两级策略，基线语义）：
 *  1. 优先"established tabs"（非本次新建，由 pendingNewTabIds 排除）；
 *  2. 若无 established，同时打开的多个新标签中 id 最小者胜出（其余被并掉）。
 *
 * @param matchingTabs 同 URL 的全部候选
 * @param newTabId 当前新标签 id
 * @param pendingNewTabIds 本次新建标签集合（background 运行态）
 */
export function findReuseTarget(
  matchingTabs: readonly TabRecord[],
  newTabId: number,
  pendingNewTabIds: ReadonlySet<number>
): TabRecord | undefined {
  const establishedTabs = matchingTabs.filter(
    (tab) => tab.id !== newTabId && !pendingNewTabIds.has(tab.id)
  );
  if (establishedTabs.length > 0) return preferredExistingTab(establishedTabs);

  const simultaneouslyOpenedTabs = matchingTabs
    .filter((tab) => pendingNewTabIds.has(tab.id))
    .sort((a, b) => a.id - b.id);
  const oldestNewTab = simultaneouslyOpenedTabs[0];
  return oldestNewTab?.id === newTabId ? undefined : oldestNewTab;
}

/** 豁免 key（windowId + url）。 */
export function duplicateAllowanceKey(windowId: number, url: string): string {
  return `${windowId}:${url}`;
}
