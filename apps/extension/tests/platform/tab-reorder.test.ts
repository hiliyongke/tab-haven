import { describe, expect, it } from 'vitest';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import {
  computeGroupMoveIndex,
  computeNativeGroupMoveIndex,
  computeReorderIndex
} from '@/platform/tabReorder';

function tab(id: number, index: number, groupId = NO_GROUP): TabRecord {
  return {
    id,
    windowId: 1,
    index,
    active: false,
    pinned: false,
    incognito: false,
    groupId
  };
}

describe('computeReorderIndex', () => {
  const tabs = [tab(1, 0), tab(2, 1), tab(3, 2), tab(4, 3)];

  it('Given source 与 target 都在窗口内 When 放到 target 之前 Then 返回 target 的扁平索引', () => {
    expect(computeReorderIndex({ tabs, sourceId: 4, targetId: 2, placeAfter: false })).toBe(1);
  });

  it('Given source 与 target 都在窗口内 When 放到 target 之后 Then 返回 target 扁平索引 +1', () => {
    expect(computeReorderIndex({ tabs, sourceId: 1, targetId: 2, placeAfter: true })).toBe(1);
  });

  it('Given target 不存在 When 计算 Then 返回 -1（调用方放弃移动）', () => {
    expect(computeReorderIndex({ tabs, sourceId: 1, targetId: 99, placeAfter: true })).toBe(-1);
  });

  it('Given source 不存在 When 计算 Then 返回 -1', () => {
    expect(computeReorderIndex({ tabs, sourceId: 99, targetId: 1, placeAfter: true })).toBe(-1);
  });
});

describe('computeGroupMoveIndex', () => {
  const tabs = [tab(1, 0), tab(2, 1), tab(3, 2), tab(4, 3), tab(5, 4)];

  it('Given source 组与目标组都存在 When 放到目标组之前 Then 返回目标组首个成员索引', () => {
    expect(
      computeGroupMoveIndex({
        tabs,
        sourceTabIds: [1],
        targetTabIds: [3, 4],
        placeAfter: false
      })
    ).toBe(1);
  });

  it('Given source 组与目标组都存在 When 放到目标组之后 Then 返回目标组末成员索引 +1', () => {
    expect(
      computeGroupMoveIndex({
        tabs,
        sourceTabIds: [1],
        targetTabIds: [3, 4],
        placeAfter: true
      })
    ).toBe(3);
  });

  it('Given source 组为空 When 计算 Then 返回 -1', () => {
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: [], targetTabIds: [2], placeAfter: true })
    ).toBe(-1);
  });

  it('Given 目标组不在窗口内 When 计算 Then 返回 -1', () => {
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: [1], targetTabIds: [99], placeAfter: true })
    ).toBe(-1);
  });
});

describe('computeNativeGroupMoveIndex', () => {
  const tabs = [tab(1, 0, 10), tab(2, 1, NO_GROUP), tab(3, 2, 20), tab(4, 3, 20), tab(5, 4, 30)];

  it('Given 目标组存在 When 放到目标组之前 Then 返回摘除自身后的目标组序号', () => {
    expect(
      computeNativeGroupMoveIndex({ tabs, sourceGroupId: 10, targetGroupId: 20, placeAfter: false })
    ).toBe(0);
  });

  it('Given 目标组存在 When 放到目标组之后 Then 返回摘除自身后的目标组序号 +1', () => {
    expect(
      computeNativeGroupMoveIndex({ tabs, sourceGroupId: 10, targetGroupId: 20, placeAfter: true })
    ).toBe(1);
  });

  it('Given 放到最后一组之后 When 计算 Then 返回接口约定的 -1', () => {
    expect(
      computeNativeGroupMoveIndex({ tabs, sourceGroupId: 10, targetGroupId: 30, placeAfter: true })
    ).toBe(-1);
  });

  it('Given 目标组已不存在 When 计算 Then 返回 undefined', () => {
    expect(
      computeNativeGroupMoveIndex({ tabs, sourceGroupId: 10, targetGroupId: 99, placeAfter: true })
    ).toBeUndefined();
  });
});
