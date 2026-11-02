import { describe, expect, it } from 'vitest';
import { deriveSections } from '@/core/site/Sections';
import { planAutoGroupDomainCorrections, planAutoGroups } from '@/core/group/AutoGrouping';
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

  it('成员跨站点漂移的原生组不归并，跨域成员按自身域名拆分', () => {
    // Given 域名命名的组 7 里混入一个 beta 子域成员（Chrome 组继承的跨域新标签）
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://beta.example.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'alpha.example.com' }];

    // When 派生展示视图
    const sections = deriveSections({ tabs, groups, threshold: 1 });

    // Then 组 7 仍是独立原生分区（不归并），只留域名锚点
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1]);
    // 拆出的成员与同站点未分组标签一起按自身域名成组；浏览器侧 groupId 未被改写
    const beta = sections.find((s) => s.kind === 'site' && s.siteKey === 'beta.example.com');
    expect(beta?.kind === 'site' ? beta.tabs.map((tab) => tab.id).sort() : []).toEqual([2, 3]);
    expect(beta?.kind === 'site' ? beta.tabs.find((tab) => tab.id === 2)?.groupId : undefined).toBe(
      7
    );
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

    // Then 组 7 仍不归并；8080 成员被拆出，不再挂在 3000 标题下，与 3000 未分组标签同进未分组
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1]);
    expect(sections.some((s) => s.kind === 'site' && s.siteKey === 'localhost:3000')).toBe(false);
    const ungrouped = sections.find((s) => s.kind === 'ungrouped');
    expect(
      ungrouped?.kind === 'ungrouped' ? ungrouped.tabs.map((tab) => tab.id).sort() : []
    ).toEqual([2, 3]);
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

describe('deriveSections 原生组域名漂移拆分（Chrome 组继承）', () => {
  const domainGroup: TabGroupRecord[] = [{ id: 7, title: 'github.com' }];
  const groupedTab = (id: number, url: string, partial: Partial<TabRecord> = {}): TabRecord =>
    makeTab(id, url, { groupId: 7, ...partial });

  it('组内锚点成员不在快照里时，跨域标签仍被拆出且不留下空分组', () => {
    // Given 域名命名的组里只剩一个从该站点文档点开的跨域新标签
    // （同域名锚点成员已被固定空间排除或关闭，这是实际复现场景）
    const tabs = [groupedTab(1, 'https://buy.cloud.tencent.com/edgeone', { index: 1 })];

    // When 派生展示视图
    const sections = deriveSections({
      tabs,
      groups: [{ id: 7, title: 'doc.weixin.qq.com' }]
    });

    // Then 旧域名分区消失（不留空卡片），跨域标签按自身域名进未分组，groupId 未变
    expect(sections.some((s) => s.kind === 'native')).toBe(false);
    const ungrouped = sections.find((s) => s.kind === 'ungrouped');
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs.map((tab) => tab.id) : []).toEqual([1]);
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs[0]?.groupId : undefined).toBe(7);
  });

  it('含点的中文自定义名不会被误判为域名组', () => {
    // Given 自定义名含点，URL 会把它转成 punycode，但不是域名命名的组
    const tabs = [
      makeTab(1, 'https://github.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://notion.so/x', { groupId: 7, index: 2 })
    ];

    const sections = deriveSections({ tabs, groups: [{ id: 7, title: '企微.文档' }] });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('从域名组里点开的跨域新标签不再显示在旧域名分组下', () => {
    // Given 组 7（github.com）里有一个 notion.so 的跨域新标签，该域名数量不足阈值
    const tabs = [
      groupedTab(1, 'https://github.com/a', { index: 1 }),
      groupedTab(2, 'https://notion.so/x', { index: 2 })
    ];

    // When 派生展示视图
    const sections = deriveSections({ tabs, groups: domainGroup });

    // Then 旧域名分区只剩锚点，跨域标签进未分组；TabRecord 的 groupId 未被伪造
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1]);
    const ungrouped = sections.find((s) => s.kind === 'ungrouped');
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs.map((tab) => tab.id) : []).toEqual([2]);
    expect(ungrouped?.kind === 'ungrouped' ? ungrouped.tabs[0]?.groupId : undefined).toBe(7);
  });

  it('拆出的跨域标签达阈值时按自身域名成组', () => {
    // Given 两个跨域新标签，达到默认阈值 2
    const tabs = [
      groupedTab(1, 'https://github.com/a', { index: 1 }),
      groupedTab(2, 'https://notion.so/x', { index: 2 }),
      groupedTab(3, 'https://notion.so/y', { index: 3 })
    ];

    // When 派生展示视图
    const sections = deriveSections({ tabs, groups: domainGroup });

    // Then 新域名独立成区，旧分区只剩锚点
    const notion = sections.find((s) => s.kind === 'site' && s.siteKey === 'notion.so');
    expect(notion?.kind === 'site' ? notion.tabs.map((tab) => tab.id).sort() : []).toEqual([2, 3]);
    expect(sections.find((s) => s.kind === 'native')?.tabs.map((tab) => tab.id)).toEqual([1]);
  });

  it('用户自定义命名的组整组保留（绝不打扰手动分组）', () => {
    // Given 组标题是「工作台」，没有域名锚点
    const tabs = [
      makeTab(1, 'https://github.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://notion.so/x', { groupId: 7, index: 2 })
    ];

    // When 派生展示视图
    const sections = deriveSections({ tabs, groups: [{ id: 7, title: '工作台' }] });

    // Then 组内成员原样保留，不进未分组
    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
    expect(sections.find((s) => s.kind === 'ungrouped')).toBeUndefined();
  });

  it('未命名组没有域名锚点，整组保留', () => {
    const tabs = [
      makeTab(1, 'https://github.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://notion.so/x', { groupId: 7, index: 2 })
    ];

    const sections = deriveSections({ tabs, groups: [{ id: 7 }] });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('URL 尚未提交的新标签留在原组，下一次快照再判定', () => {
    // Given 导航早期：url 为空，只有 pendingUrl
    const tabs = [
      groupedTab(1, 'https://github.com/a', { index: 1 }),
      groupedTab(2, '', { index: 2, pendingUrl: 'https://notion.so/x' })
    ];

    const sections = deriveSections({ tabs, groups: domainGroup });

    const native = sections.find((s) => s.kind === 'native');
    expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
  });

  it('来源树与语言模式保留原生组分区，不拆分', () => {
    const tabs = [
      groupedTab(1, 'https://github.com/a', { index: 1 }),
      groupedTab(2, 'https://notion.so/x', { index: 2 })
    ];

    for (const groupMode of ['opener', 'language'] as const) {
      const sections = deriveSections({ tabs, groups: domainGroup, groupMode });
      const native = sections.find((s) => s.kind === 'native');
      expect(native?.kind === 'native' ? native.tabs.map((tab) => tab.id) : []).toEqual([1, 2]);
    }
  });

  it('对账视图保留真实组成员，域名漂移校正仍可命中', () => {
    // Given 展示视图与 background 对账视图拿到同一份快照
    const tabs = [
      groupedTab(1, 'https://github.com/a', { index: 1 }),
      groupedTab(2, 'https://notion.so/x', { index: 2 })
    ];

    // When 分别派生两种视图
    const shown = deriveSections({ tabs, groups: domainGroup });
    const reconciled = deriveSections({
      tabs,
      groups: domainGroup,
      splitDriftedNativeTabs: false
    });

    // Then 展示视图已无漂移成员；对账视图仍能看到，交给 ungroup 修正浏览器侧分组
    expect(planAutoGroupDomainCorrections(shown, new Set([7]))).toEqual([]);
    expect(planAutoGroupDomainCorrections(reconciled, new Set([7]))).toMatchObject([
      { groupId: 7, tabIds: [2] }
    ]);
  });
});

describe('deriveSections 无分组与根域名模式', () => {
  it('不分组模式：未固定标签含原生组成员全部平铺，固定标签仍独立', () => {
    // Given 一个原生组成员、一个未分组标签、一个固定标签
    const tabs = [
      makeTab(1, 'https://a.com/1', { groupId: 7, index: 1 }),
      makeTab(2, 'https://b.com/2', { index: 2 }),
      makeTab(3, 'https://c.com/3', { pinned: true, index: 0 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'a.com' }];

    // When 派生不分组视图
    const sections = deriveSections({ tabs, groups, groupMode: 'none' });

    // Then 只有固定区与平铺区，原生组成员没有从列表里消失
    expect(sections.map((section) => section.kind)).toEqual(['pinned', 'ungrouped']);
    expect(sections[1]?.tabs.map((tab) => tab.id)).toEqual([1, 2]);
    expect(sections[1]?.title).toBe('全部标签');
  });

  it('不分组模式：排序仍遵循 sortMode', () => {
    const tabs = [
      makeTab(1, 'https://a.com/1', { index: 3, lastAccessed: 30 }),
      makeTab(2, 'https://b.com/2', { index: 1, lastAccessed: 10 })
    ];
    const sections = deriveSections({ tabs, groups: [], groupMode: 'none', sortMode: 'recency' });
    expect(sections[0]?.tabs.map((tab) => tab.id)).toEqual([1, 2]);
  });

  it('按根域名：同注册域不同子域合成一个分区', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { index: 2 }),
      makeTab(3, 'https://example.com/c', { index: 3 }),
      makeTab(4, 'https://other.com/d', { index: 4 })
    ];

    const sections = deriveSections({ tabs, groups: [], groupMode: 'rootDomain' });

    const root = sections.find((section) => section.kind === 'site');
    expect(root?.kind === 'site' ? root.siteKey : '').toBe('example.com');
    expect(root?.title).toBe('example.com');
    expect(root?.tabs.map((tab) => tab.id)).toEqual([1, 2, 3]);
    expect(
      sections.find((section) => section.kind === 'ungrouped')?.tabs.map((tab) => tab.id)
    ).toEqual([4]);
  });

  it('按根域名：根域名组里的子域成员不被拆出', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { groupId: 7, index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'example.com' }];

    const sections = deriveSections({ tabs, groups, groupMode: 'rootDomain' });

    expect(
      sections.find((section) => section.kind === 'native')?.tabs.map((tab) => tab.id)
    ).toEqual([1, 2]);
  });

  it('按根域名：跨域新标签仍从域名组拆出并按自身域名呈现', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://notion.so/x', { groupId: 7, index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'example.com' }];

    const sections = deriveSections({ tabs, groups, groupMode: 'rootDomain' });

    expect(
      sections.find((section) => section.kind === 'native')?.tabs.map((tab) => tab.id)
    ).toEqual([1]);
    const ungrouped = sections.find((section) => section.kind === 'ungrouped');
    expect(ungrouped?.tabs.map((tab) => tab.id)).toEqual([2]);
    expect(ungrouped?.tabs[0]?.groupId).toBe(7);
  });

  it('按根域名：对账视图保留真实组成员', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { groupId: 7, index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'example.com' }];

    const sections = deriveSections({
      tabs,
      groups,
      groupMode: 'rootDomain',
      splitDriftedNativeTabs: false
    });

    expect(
      sections.find((section) => section.kind === 'native')?.tabs.map((tab) => tab.id)
    ).toEqual([1, 2]);
  });

  it('按根域名：子域名命名的旧组整组保留（不误拆用户手动组）', () => {
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://other.com/b', { groupId: 7, index: 2 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'alpha.example.com' }];

    const sections = deriveSections({ tabs, groups, groupMode: 'rootDomain' });

    expect(
      sections.find((section) => section.kind === 'native')?.tabs.map((tab) => tab.id)
    ).toEqual([1, 2]);
  });

  it('按根域名：根域名组与同注册域未分组标签归并到同一分区', () => {
    // Given 一个跨子域的根域名组，外加同注册域的第三个子域标签
    const tabs = [
      makeTab(1, 'https://alpha.example.com/a', { groupId: 7, index: 1 }),
      makeTab(2, 'https://beta.example.com/b', { groupId: 7, index: 2 }),
      makeTab(3, 'https://gamma.example.com/c', { index: 3 })
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: 'example.com' }];

    // When 派生按根域名视图
    const sections = deriveSections({ tabs, groups, groupMode: 'rootDomain' });

    // Then 归并判定按同一个根域桶生效：原生分区被吸收，三个标签进同一分区
    expect(sections.filter((section) => section.kind === 'native')).toHaveLength(0);
    const root = sections.find((section) => section.kind === 'site');
    expect(root?.kind === 'site' ? root.siteKey : '').toBe('example.com');
    expect(root?.tabs.map((tab) => tab.id).sort()).toEqual([1, 2, 3]);
    expect(root?.kind === 'site' ? root.mergedGroupIds : []).toEqual([7]);
  });
});
