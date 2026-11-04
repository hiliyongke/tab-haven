import { NO_GROUP, type TabRecord } from '@/core/tab-types';

/** 依据侧边栏展示顺序计算把 source 放到 target 之前/之后时应去的原生索引（窗口内标签索引连续 0..n-1）。 */
export function computeReorderIndex(params: {
  tabs: readonly TabRecord[];
  sourceId: number;
  targetId: number;
  placeAfter: boolean;
}): number {
  const { tabs, sourceId, targetId, placeAfter } = params;
  const ordered = [...tabs].filter((tab) => tab.id !== sourceId).sort((a, b) => a.index - b.index);
  const targetPos = ordered.findIndex((tab) => tab.id === targetId);
  if (targetPos === -1) return -1;
  const source = tabs.find((tab) => tab.id === sourceId);
  if (!source) return -1;
  ordered.splice(placeAfter ? targetPos + 1 : targetPos, 0, source);
  return ordered.findIndex((tab) => tab.id === sourceId);
}

/**
 * 计算把 source 整组搬到 target 组之前/之后时，组内首个标签应去的原生索引。
 * 站点组 / 语言组这类「虚拟分区」没有原生 groupId，无法用 tabGroups.move；但它们的展示顺序
 * 由组内标签的 index 决定，因此把整组标签连续地落到目标组的前/后即可改变分区顺序并持久化。
 * 返回 -1 表示目标组已不存在（拖拽期间被关闭/解散），调用方应静默放弃。
 */
export function computeGroupMoveIndex(params: {
  tabs: readonly TabRecord[];
  sourceTabIds: readonly number[];
  targetTabIds: readonly number[];
  placeAfter: boolean;
}): number {
  const { tabs, sourceTabIds, targetTabIds, placeAfter } = params;
  const sourceIds = new Set(sourceTabIds);
  if (sourceIds.size === 0) return -1;
  const targetIds = new Set(targetTabIds);
  if (targetIds.size === 0) return -1;

  const ordered = [...tabs]
    .filter((tab) => !sourceIds.has(tab.id))
    .sort((a, b) => a.index - b.index);
  let first: number | undefined;
  let last: number | undefined;
  for (let i = 0; i < ordered.length; i += 1) {
    if (targetIds.has(ordered[i]!.id)) {
      if (first === undefined) first = i;
      last = i;
    }
  }
  if (first === undefined || last === undefined) return -1;
  return placeAfter ? last + 1 : first;
}

/**
 * 把「标签序号」换算成 `chrome.tabGroups.move` 需要的**组序号**。
 *
 * 两者不是一回事：分组接口的 index 是窗口内标签组的排列位置（0..组数-1），
 * 而分区拖拽算出的是标签序号。窗口里只要存在未分组标签或其它组，数值就会错位，
 * 表现为「拖到 A 组后面，组却落到别处」。这里按「组的首个标签位置」还原组顺序，
 * 再以目标组为锚点插入。
 *
 * 返回 `undefined` 表示目标组已不存在（拖拽期间被解散），调用方应静默放弃；
 * 返回 `-1` 是接口约定的「放到窗口最后」，不是失败。
 */
export function computeNativeGroupMoveIndex(params: {
  tabs: readonly TabRecord[];
  sourceGroupId: number;
  targetGroupId: number;
  placeAfter: boolean;
}): number | undefined {
  const { tabs, sourceGroupId, targetGroupId, placeAfter } = params;
  const order: number[] = [];
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    if (tab.groupId === NO_GROUP || order.includes(tab.groupId)) continue;
    order.push(tab.groupId);
  }
  // 先摘掉自身再定位：否则「拖到目标之后」会被自身占位顶偏一位。
  const withoutSource = order.filter((id) => id !== sourceGroupId);
  const targetAt = withoutSource.indexOf(targetGroupId);
  if (targetAt === -1) return undefined;
  const next = placeAfter ? targetAt + 1 : targetAt;
  // 落到末尾时用 -1（接口约定的「放到窗口最后」）：index 等于组数不保证被接受。
  return next >= withoutSource.length ? -1 : next;
}
