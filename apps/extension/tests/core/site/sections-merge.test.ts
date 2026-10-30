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
 * alpha.example.com 的文智缰在原生组 7 里（建组后打开的 CDN 标签未入组），
 * 未分组的 alpha/beta 标签经站点聚合平铺为两个子域分区。
 */
const FRAGMENT_TABS: TabRecord[] = [
  makeTab(1, 'https://alpha.example.com/console', { groupId: 7, index: 1 }),
  makeTab(2, 'https://alpha.example.com/cdn', { index: 2 }),
  makeTab(3, 'https://beta.example.com/buy1', { index: 3 }),
  makeTab(4, 'https://beta.example.com/buy2', { index: 4 })
];
const FRAGMENT_GROUPS: TabGroupRecord[] = [{ id: 7, title: 'alpha.example.com', color: 'blue' }];

describe('deriveSections 同站点归并', () => {
  it('域名命名的同站点原生组并入站点分区', () => {
    const sections = deriveSections({ tabs: FRAGMENT_TABS, groups: FRAGMENT_GROUPS, threshold: 1 });

    // 原生组 7 不再单独成区
    expect(sections.filter((s) => s.kind === 'native')).toHaveLength(0);
    // 平铺模式：alpha/beta 各自独立站点分区；alpha 分区吸收原生组 7 并携带归并来源
    const alpha = sections.find((s) => s.kind === 'site' && s.siteKey === 'alpha.example.com');
    expect(alpha).toBeDefined();
    if (alpha?.kind !== 'site') return;
    expect(alpha.tabs.map((tab) => tab.id).sort()).toEqual([1, 2]);
    expect(alpha.mergedGroupIds).toEqual([7]);
    // beta 分区不受影响
    const beta = sections.find((s) => s.kind === 'site' && s.siteKey === 'beta.example.com');
    expect(beta?.kind === 'site' ? beta.tabs.map((tab) => tab.id) : []).toEqual([3, 4]);
  });

  it('用户自定义命名的原生组绝不归并', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/console', { groupId: 7, index: 1 }),
      makeTab(2, 'https://alpha.example.com/cdn', { index: 2 })
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
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://beta.example.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'alpha.example.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('无同子域未分组标签时不归并（原生组照常渲染）', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'alpha.example.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1]);
    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.tabs.map((tab) => tab.id) : []).toEqual([2]);
  });

  it('未分组同站点标签不足阈值时，与同站点原生组凑数归并（新标签不滞留未分组）', () => {
    // gamma.example.com 原生组有 4 个成员，临时区另有 1 个同站点标签；
    // 合计 5 个标签达到阈值 2 时，站点分区吸收原生组与未分组标签。
    const tabs = [
      makeTab(1, 'https://gamma.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://gamma.example.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://gamma.example.com/c', { groupId: 7, index: 3 }),
      makeTab(4, 'https://gamma.example.com/d', { groupId: 7, index: 4 }),
      makeTab(5, 'https://gamma.example.com/story/detail/1', { index: 5 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'gamma.example.com', color: 'blue' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });

    // 原生组被吸收（不再单独成区），5 个标签全部进站点分区
    expect(sections.filter((s) => s.kind === 'native')).toHaveLength(0);
    const gamma = sections.find((s) => s.kind === 'site');
    expect(gamma?.kind === 'site' ? gamma.tabs.map((tab) => tab.id) : []).toEqual([1, 2, 3, 4, 5]);
    expect(gamma?.kind === 'site' ? gamma.mergedGroupIds : []).toEqual([7]);
    // 未分组区不再包含该标签（不重复渲染）
    expect(sections.find((s) => s.kind === 'ungrouped')).toBeUndefined();
  });

  it('未分组与原生组总数不足阈值时不归并（原生组与未分组各自渲染）', () => {
    const tabs = [
      makeTab(1, 'https://gamma.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://gamma.example.com/b', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'gamma.example.com' }];
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
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://alpha.example.com/b', { groupId: 7, index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'alpha.example.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    expect(sections.filter((s) => s.kind === 'site')).toHaveLength(0);
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('本地/带端口站点：组标题含端口时同站点归并同样生效', () => {
    // localhost:3000 的站点标题包含端口时，应与该站点成员匹配并执行归并。
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
    // localhost:3000 与 localhost:8080 是不同站点分区，各自保留对应端口的标签。
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

  it('异端口的未分组标签不并入 localhost:3000 归并分区（端口是本地站点身份的一部分）', () => {
    // localhost:3000 的归并分区只包含同端口标签；localhost:8080 的标签仍留在临时区。
    const tabs = [
      makeTab(1, 'http://localhost:3000/a', { groupId: 7, index: 1 }),
      makeTab(2, 'http://localhost:3000/b', { index: 2 }),
      makeTab(3, 'http://localhost:8080/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'localhost:3000' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });

    const site3000 = sections.find((s) => s.kind === 'site' && s.siteKey === 'localhost:3000');
    expect(site3000?.kind === 'site' ? site3000.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
    // 异端口分区不存在
    expect(sections.some((s) => s.kind === 'site' && s.siteKey === 'localhost:8080')).toBe(false);
    // id3 留在未分组
    const ungrouped = sections.find((s) => s.kind === 'ungrouped');
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs.map((tab) => tab.id) : []).toEqual([3]);
  });

  it('同一原生组混有 localhost 不同端口时不作为同站点候选归并', () => {
    // Given 原生组标题指向 3000，但组内同时有 3000 与 8080 成员
    const tabs = [
      makeTab(1, 'http://localhost:3000/a', { groupId: 7, index: 1 }),
      makeTab(2, 'http://localhost:8080/b', { groupId: 7, index: 2 }),
      makeTab(3, 'http://localhost:3000/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'localhost:3000' }];

    // When 派生站点分区
    const sections = deriveSections({ tabs, groups, threshold: 2 });

    // Then 混端口原生组保持原样，8080 成员不会被吞进 3000 分区
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
    expect(sections.some((s) => s.kind === 'site' && s.siteKey === 'localhost:3000')).toBe(false);
    const ungrouped = sections.find((s) => s.kind === 'ungrouped');
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs.map((tab) => tab.id) : []).toEqual([3]);
  });

  it('IP 站点同样按端口区分：127.0.0.1:8080 的唯一标签不被 3000 归并吞掉', () => {
    // IP 主机的不同端口分别作为独立站点身份。
    const tabs = [
      makeTab(1, 'http://127.0.0.1:3000/a', { groupId: 7, index: 1 }),
      makeTab(2, 'http://127.0.0.1:3000/b', { index: 2 }),
      makeTab(3, 'http://127.0.0.1:8080/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: '127.0.0.1:3000' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });

    const site3000 = sections.find((s) => s.kind === 'site' && s.siteKey === '127.0.0.1:3000');
    expect(site3000?.kind === 'site' ? site3000.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
    const ungrouped = sections.find((s) => s.kind === 'ungrouped');
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs.map((tab) => tab.id) : []).toEqual([3]);
    // 下游自动分组同样按端口隔离：异端口标签不进吸收计划
    expect(planAutoGroups(sections)).toMatchObject([
      { title: '127.0.0.1:3000', tabIds: [2], absorbIntoGroupId: 7 }
    ]);
  });

  it('全部未分组时按站点聚合且不归并原生组', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { index: 2 })
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

    // 平铺后 alpha/beta 是两个独立分区：alpha 产出吸收计划，beta 直接产出建组计划。
    expect(plans).toHaveLength(2);
    const absorb = plans.find((plan) => plan.absorbIntoGroupId === 7);
    expect(absorb).toMatchObject({ title: 'alpha.example.com', tabIds: [2] });
    const fresh = plans.find((plan) => plan.absorbIntoGroupId === undefined);
    expect(fresh).toMatchObject({ title: 'beta.example.com', tabIds: [3, 4] });
  });

  it('凑数归并分区：未分组同站点标签被真正吸收进既有原生组', () => {
    // 自动分组开启时，未分组同站点标签生成并入既有原生组的计划。
    const tabs = [
      makeTab(1, 'https://gamma.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://gamma.example.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://gamma.example.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'gamma.example.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 2 });
    const plans = planAutoGroups(sections);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      title: 'gamma.example.com',
      tabIds: [3],
      absorbIntoGroupId: 7
    });
  });

  it('多个原生组混入归并分区时保守跳过（不建新组也不吸收）', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://alpha.example.com/b', { groupId: 8, index: 2 }),
      makeTab(3, 'https://alpha.example.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [
      { id: 7, title: 'alpha.example.com' },
      { id: 8, title: 'alpha.example.com' }
    ];
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.mergedGroupIds : []).toEqual([7, 8]);
    expect(planAutoGroups(sections)).toHaveLength(0);
  });

  it('跨窗口搜索（groups 不含该标签的 groupId）：兜底进站点分区，但不产出新建组计划', () => {
    // 跨窗口搜索时 tabs 含其它窗口标签、而 groups 只含当前窗口：标签 1/2 属于
    // 其它窗口的原生组 9，此处「分组信息不可知」。
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { windowId: 2, groupId: 9, index: 1 }),
      makeTab(2, 'https://alpha.example.com/b', { windowId: 2, groupId: 9, index: 2 })
    ];
    const sections = deriveSections({ tabs, groups: [], threshold: 2 });

    // 兜底生效：标签不会从列表里消失（进站点分区）
    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind === 'site' ? site.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
    expect(sections.filter((s) => s.kind === 'ungrouped')).toHaveLength(0);
    // 但自动分组不为它们新建原生组（会覆盖浏览器侧既有归属）
    expect(planAutoGroups(sections).filter((plan) => plan.absorbIntoGroupId === undefined)).toEqual(
      []
    );
  });

  it('已入组标签保持原生组归属，未分组站点生成建组计划', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'alpha.example.com' }];
    const sections = deriveSections({ tabs, groups, threshold: 1 });
    // beta 站点分区全部未分组 → 正常建组计划；alpha 原生组照常渲染不参与
    const plans = planAutoGroups(sections);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: 'beta.example.com', tabIds: [2] });
    expect(plans[0]?.absorbIntoGroupId).toBeUndefined();
  });
});
