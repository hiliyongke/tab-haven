import { describe, expect, it } from 'vitest';
import type { TabRecord } from '@/core/tab-types';
import { computeSplitGroupRoles } from '@/ui/tabs/splitGroupRoles';

function makeTab(id: number, splitViewId?: number): TabRecord {
  return {
    id,
    windowId: 1,
    index: id,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    splitViewId
  };
}

describe('computeSplitGroupRoles', () => {
  it('相邻同 splitViewId 两标签 → first/last', () => {
    const tabs = [makeTab(1, 5), makeTab(2, 5)];
    const roles = computeSplitGroupRoles(tabs);
    expect(roles.get(1)).toBe('first');
    expect(roles.get(2)).toBe('last');
  });

  it('相邻同 splitViewId 三标签 → first/middle/last', () => {
    const tabs = [makeTab(1, 7), makeTab(2, 7), makeTab(3, 7)];
    const roles = computeSplitGroupRoles(tabs);
    expect(roles.get(1)).toBe('first');
    expect(roles.get(2)).toBe('middle');
    expect(roles.get(3)).toBe('last');
  });

  it('单标签带 splitViewId → 仍画线（first）', () => {
    const tabs = [makeTab(1, 9), makeTab(2)];
    const roles = computeSplitGroupRoles(tabs);
    expect(roles.get(1)).toBe('first');
    expect(roles.get(2)).toBeUndefined();
  });

  it('无分屏 → 全 undefined', () => {
    const tabs = [makeTab(1), makeTab(2), makeTab(3)];
    const roles = computeSplitGroupRoles(tabs);
    expect(roles.size).toBe(0);
  });

  it('同 splitViewId 但被打散（中间隔其它标签）→ 只对连续段画线', () => {
    const tabs = [makeTab(1, 5), makeTab(2), makeTab(3, 5)];
    const roles = computeSplitGroupRoles(tabs);
    // 1 单独一段（画线），2 无分屏，3 单独一段（画线）
    expect(roles.get(1)).toBe('first');
    expect(roles.get(2)).toBeUndefined();
    expect(roles.get(3)).toBe('first');
  });
});
