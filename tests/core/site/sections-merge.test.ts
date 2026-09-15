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

  it('未分组同站点标签不足阈值时，与同站点原生组凑数归并（新标签不滞留未分组）', () => {
    // 截图场景：tapd.woa.com 原生组 4 个成员 + 未分组 1 个同站点标签（如通过
    // 外链新打开的详情页）。未分组侧 1 < 阈值 2，修复前不归并、标签滞留
    // 「未分组」；判定口径改为「该站点在临时区的全部标签」（4 + 1 = 5 ≥ 2）后归并。
    const tabs = [
      makeTab(1, 'https://tapd.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://tapd.woa.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://tapd.woa.com/c', { groupId: 7, index: 3 }),
      makeTab(4, 'https://tapd.woa.com/d', { groupId: 7, index: 4 }),
      makeTab(5, 'https://tapd.woa.com/story/detail/1', { index: 5 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'tapd.woa.com', color: 'blue' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });

    // 原生组被吸收（不再单独成区），5 个标签全部进站点分区
    expect(sections.filter((s) => s.kind === 'native')).toHaveLength(0);
    const tapd = sections.find((s) => s.kind === 'site');
    expect(tapd?.kind === 'site' ? tapd.tabs.map((tab) => tab.id) : []).toEqual([1, 2, 3, 4, 5]);
    expect(tapd?.kind === 'site' ? tapd.mergedGroupIds : []).toEqual([7]);
    // 未分组区不再包含该标签（不重复渲染）
    expect(sections.find((s) => s.kind === 'ungrouped')).toBeUndefined();
  });

  it('未分组与原生组总数不足阈值时不归并（原生组与未分组各自渲染）', () => {
    const tabs = [
      makeTab(1, 'https://tapd.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://tapd.woa.com/b', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'tapd.woa.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 3 });

    // 1 + 1 = 2 < 3：原生组照常渲染，未分组标签留在未分组，两边都不动
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1]);
    expect(sections.filter((s) => s.kind === 'site')).toHaveLength(0);
    const ungrouped = sections.find((s) => s.kind === 'ungrouped');
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs.map((tab) => tab.id) : []).toEqual([2]);
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

  it('本地/带端口站点：组标题含端口时同站点归并同样生效', () => {
    // 自动建组对本地站点的标题是解析器原始 value（含端口，如 localhost:3000）；
    // 此前标题比对一律用 subLabel（丢端口）→ 恒不匹配，本地站点碎片化修不了。
    const tabs = [
      makeTab(1, 'http://localhost:3000/a', { groupId: 7, index: 1 }),
      makeTab(2, 'http://localhost:3000/b', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'localhost:3000' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });

    expect(sections.filter((s) => s.kind === 'native')).toHaveLength(0);
    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.siteKey : '').toBe('localhost:3000');
    expect(site?.kind === 'site' ? site.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('本地站点按端口区分：localhost:3000 的归并不串到 localhost:8080 分区', () => {
    // 本地站点的 registrableDomain 不含端口，只用 (注册域, 子域) 匹配会让
    // localhost:3000 的候选命中 localhost:8080 的分区（张冠李戴）。
    const tabs = [
      makeTab(1, 'http://localhost:3000/a', { groupId: 7, index: 1 }),
      makeTab(2, 'http://localhost:3000/b', { index: 2 }),
      makeTab(3, 'http://localhost:8080/c', { index: 3 }),
      makeTab(4, 'http://localhost:8080/d', { index: 4 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'localhost:3000' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });

    const site3000 = sections.find((s) => s.kind === 'site' && s.siteKey === 'localhost:3000');
    const site8080 = sections.find((s) => s.kind === 'site' && s.siteKey === 'localhost:8080');
    expect(site3000?.kind === 'site' ? site3000.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
    expect(site8080?.kind === 'site' ? site8080.tabs.map((tab) => tab.id) : []).toEqual([3, 4]);
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

  it('凑数归并分区：未分组同站点标签被真正吸收进既有原生组', () => {
    // 与上一条同场景：自动分组开启时，planAutoGroups 应把未分组标签
    // 并入既有原生组（absorbIntoGroupId），而不只是展示层归并。
    const tabs = [
      makeTab(1, 'https://tapd.woa.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://tapd.woa.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://tapd.woa.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'tapd.woa.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });
    const plans = planAutoGroups(sections);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: 'tapd.woa.com', tabIds: [3], absorbIntoGroupId: 7 });
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
