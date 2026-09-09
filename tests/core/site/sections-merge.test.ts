import { describe, expect, it } from 'vitest';
import { deriveSections } from '@/core/site/Sections';
import { planAutoGroups } from '@/core/group/AutoGrouping';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';

function makeTab(id: number, url: string, partial: Partial<TabRecord> = {}): TabRecord {
  return {
    id,
    windowId: 1,
    index: id,
    active: false,
    pinned: false,
    incognito: false,
    url,
    title: `Tab ${id}`,
    groupId: NO_GROUP,
    ...partial
  };
}

/**
 * 截图碎片化场景：同站点标签被拆到「域名命名的原生组」与「站点聚合组」两处。
 * yehe.woa.com 的文智缰在原生组 7 里（建组后打开的 CDN 标签未入组），
 * 未分组的 yehe/tcb 标签经站点聚合平铺为两个子域分区。
 */
const FRAGMENT_TABS: TabRecord[] = [
  makeTab(1, 'https://yehe.woa.com/console', { groupId: 7, index: 1 }),
  makeTab(2, 'https://yehe.woa.com/cdn', { index: 2 }),
  makeTab(3, 'https://tcb.woa.com/buy1', { index: 3 }),
  makeTab(4, 'https://tcb.woa.com/buy2', { index: 4 })
];
const FRAGMENT_GROUPS: TabGroupRecord[] = [{ id: 7, title: 'yehe.woa.com', color: 'blue' }];

describe('deriveSections 同站点归并', () => {
  it('域名命名的同站点原生组并入站点分区（碎片化修复）', () => {
    const sections = deriveSections({ tabs: FRAGMENT_TABS, groups: FRAGMENT_GROUPS, threshold: 1 });

    // 原生组 7 不再单独成区
    expect(sections.filter((s) => s.kind === 'native')).toHaveLength(0);
    // 平铺模式：yehe/tcb 各自独立站点分区；yehe 分区吸收原生组 7 并携带归并来源
    const yehe = sections.find((s) => s.kind === 'site' && s.siteKey === 'yehe.woa.com');
    expect(yehe).toBeDefined();
    if (yehe?.kind !== 'site') return;
    expect(yehe.tabs.map((tab) => tab.id).sort()).toEqual([1, 2]);
    expect(yehe.mergedGroupIds).toEqual([7]);
    // tcb 分区不受影响
    const tcb = sections.find((s) => s.kind === 'site' && s.siteKey === 'tcb.woa.com');
    expect(tcb?.kind === 'site' ? tcb.tabs.map((tab) => tab.id) : []).toEqual([3, 4]);
  });

  it('用户自定义命名的原生组绝不归并', () => {
    const tabs = [
      makeTab(1, 'https://yehe.woa.com/console', { groupId: 7, index: 1 }),
      makeTab(2, 'https://yehe.woa.com/cdn', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: '工作台' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1]);
    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.tabs.map((tab) => tab.id) : []).toEqual([2]);
    expect(site?.kind === 'site' ? site.mergedGroupIds : []).toEqual([]);
  });

  it('成员跨子域漂移的原生组（标题与成员站点不符）不归并', () => {
    const tabs = [
      makeTab(1, 'https://yehe.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://tcb.woa.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://tcb.woa.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'yehe.woa.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('无同子域未分组标签时不归并（原生组照常渲染）', () => {
    const tabs = [
      makeTab(1, 'https://yehe.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://tcb.woa.com/b', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'yehe.woa.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1]);
    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.tabs.map((tab) => tab.id) : []).toEqual([2]);
  });

  it('纯原生组（无未分组标签）不受影响', () => {
    const tabs = [
      makeTab(1, 'https://yehe.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://yehe.woa.com/b', { groupId: 7, index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'yehe.woa.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    expect(sections.filter((s) => s.kind === 'site')).toHaveLength(0);
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('全部未分组时与原聚合行为一致（无归并）', () => {
    const tabs = [
      makeTab(1, 'https://yehe.woa.com/a', { index: 1 }),
      makeTab(2, 'https://tcb.woa.com/b', { index: 2 })
    ];
    const sections = deriveSections({ tabs, groups: [], threshold: 1 });
    expect(sections.filter((s) => s.kind === 'native')).toHaveLength(0);
    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.mergedGroupIds : []).toEqual([]);
  });
});

describe('planAutoGroups 同站点吸收', () => {
  it('归并分区：同子域未分组标签产出吸收计划；异子域分区照常独立建组（平铺）', () => {
    const sections = deriveSections({
      tabs: FRAGMENT_TABS,
      groups: FRAGMENT_GROUPS,
      threshold: 1
    });
    const plans = planAutoGroups(sections);

    // 平铺后 yehe/tcb 是两个独立分区：yehe 产出吸收计划，tcb 直接产出建组计划。
    expect(plans).toHaveLength(2);
    const absorb = plans.find((plan) => plan.absorbIntoGroupId === 7);
    expect(absorb).toMatchObject({ title: 'yehe.woa.com', tabIds: [2] });
    const fresh = plans.find((plan) => plan.absorbIntoGroupId === undefined);
    expect(fresh).toMatchObject({ title: 'tcb.woa.com', tabIds: [3, 4] });
  });

  it('多个原生组混入归并分区时保守跳过（不建新组也不吸收）', () => {
    const tabs = [
      makeTab(1, 'https://yehe.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://yehe.woa.com/b', { groupId: 8, index: 2 }),
      makeTab(3, 'https://yehe.woa.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [
      { id: 7, title: 'yehe.woa.com' },
      { id: 8, title: 'yehe.woa.com' }
    ];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.mergedGroupIds : []).toEqual([7, 8]);
    expect(planAutoGroups(sections)).toHaveLength(0);
  });

  it('非归并分区中已入组的标签仍整组跳过（原保守规则不变）', () => {
    const tabs = [
      makeTab(1, 'https://yehe.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://tcb.woa.com/b', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'yehe.woa.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });
    // tcb 站点分区全部未分组 → 正常建组计划；yehe 原生组照常渲染不参与
    const plans = planAutoGroups(sections);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: 'tcb.woa.com', tabIds: [2] });
    expect(plans[0]?.absorbIntoGroupId).toBeUndefined();
  });
});
