import { describe, expect, it } from 'vitest';
import { buildRoamOrder } from '@/core/site/roamOrder';
import type { TemporarySection } from '@/core/site/Sections';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';

/**
 * 键盘漫游序列（buildRoamOrder）行为规格。
 *
 * 契约：序列 = 「列表显示顺序」的标签 id 展开，折叠分区内的标签不进序列 ——
 * 它们在 DOM 里不存在，选中一个看不见的标签会让 Enter 变成「激活未知项」。
 */

/** 测试桩：只填充分区派生用得到的字段（id / groupId）。 */
function makeTab(id: number): TabRecord {
  return { id, groupId: NO_GROUP } as unknown as TabRecord;
}

function pinned(ids: number[]): TemporarySection {
  return { kind: 'pinned', key: 'pinned', title: 'pinned', tabs: ids.map(makeTab) };
}
function native(groupId: number, ids: number[]): TemporarySection {
  return {
    kind: 'native',
    key: `g${groupId}`,
    title: 'g',
    tabs: ids.map(makeTab),
    groupId,
    collapsed: false
  };
}
function site(siteKey: string, ids: number[]): TemporarySection {
  return { kind: 'site', key: siteKey, title: siteKey, tabs: ids.map(makeTab), siteKey };
}
function ungrouped(ids: number[]): TemporarySection {
  return { kind: 'ungrouped', key: 'ungrouped', title: 'ungrouped', tabs: ids.map(makeTab) };
}

const NONE_GROUPS: ReadonlySet<number> = new Set();
const NONE_SITES: readonly string[] = [];

describe('buildRoamOrder', () => {
  it('按显示顺序展开：固定区在前，其后是各分区', () => {
    const ids = buildRoamOrder({
      showPinnedStrip: true,
      pinnedSection: pinned([1, 2]),
      restSections: [native(7, [3, 4]), ungrouped([5])],
      collapsedGroups: NONE_GROUPS,
      collapsedSites: NONE_SITES
    });

    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('关闭常驻磁贴区时固定区不进序列', () => {
    const ids = buildRoamOrder({
      showPinnedStrip: false,
      pinnedSection: pinned([1, 2]),
      restSections: [ungrouped([3])],
      collapsedGroups: NONE_GROUPS,
      collapsedSites: NONE_SITES
    });

    expect(ids).toEqual([3]);
  });

  it('固定区未渲染（undefined）时不进序列', () => {
    const ids = buildRoamOrder({
      showPinnedStrip: true,
      pinnedSection: undefined,
      restSections: [ungrouped([3])],
      collapsedGroups: NONE_GROUPS,
      collapsedSites: NONE_SITES
    });

    expect(ids).toEqual([3]);
  });

  it('折叠的原生组不进序列（组内标签在 DOM 里不存在）', () => {
    const ids = buildRoamOrder({
      showPinnedStrip: false,
      pinnedSection: undefined,
      restSections: [native(7, [1, 2]), native(8, [3])],
      collapsedGroups: new Set([7]),
      collapsedSites: NONE_SITES
    });

    expect(ids).toEqual([3]);
  });

  it('折叠的站点分区不进序列（折叠集合为 Set 或数组都成立）', () => {
    const base = {
      showPinnedStrip: false,
      pinnedSection: undefined,
      restSections: [site('a.com', [1]), site('b.com', [2])],
      collapsedGroups: NONE_GROUPS
    };

    expect(buildRoamOrder({ ...base, collapsedSites: new Set(['a.com']) })).toEqual([2]);
    expect(buildRoamOrder({ ...base, collapsedSites: ['a.com'] })).toEqual([2]);
  });

  it('未分组分区没有折叠态，始终进序列', () => {
    const ids = buildRoamOrder({
      showPinnedStrip: false,
      pinnedSection: undefined,
      restSections: [ungrouped([1, 2])],
      collapsedGroups: new Set([7]),
      collapsedSites: ['a.com']
    });

    expect(ids).toEqual([1, 2]);
  });

  it('全部分区折叠时序列为空（Enter 不激活任何项）', () => {
    const ids = buildRoamOrder({
      showPinnedStrip: false,
      pinnedSection: undefined,
      restSections: [native(7, [1]), site('a.com', [2])],
      collapsedGroups: new Set([7]),
      collapsedSites: ['a.com']
    });

    expect(ids).toEqual([]);
  });
});
