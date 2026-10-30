import { describe, expect, it } from 'vitest';
import {
  groupColorForLabel,
  planAutoGroupDomainCorrections,
  planAutoGroups,
  planRegroup
} from '@/core/group/AutoGrouping';
import { AUTO_GROUP_COLOR_NAMES, GROUP_COLOR_NAMES } from '@/core/group/groupColors';
import type { TemporarySection } from '@/core/site/Sections';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';

function makeTab(id: number, partial: Partial<TabRecord> = {}): TabRecord {
  return {
    id,
    windowId: 1,
    index: id,
    active: false,
    pinned: false,
    incognito: false,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    groupId: NO_GROUP,
    ...partial
  };
}

function siteSection(title: string, tabs: TabRecord[]): TemporarySection {
  return {
    kind: 'site',
    key: `site-${title}`,
    title,
    tabs,
    siteKey: title
  };
}

describe('planAutoGroups', () => {
  it('全部未分组的站点组产出计划（标题 + 稳定色）', () => {
    const plans = planAutoGroups([siteSection('github.com', [makeTab(1), makeTab(2)])]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: 'github.com', tabIds: [1, 2] });
  });

  it('单一标签站点（阈值 1）也产出计划', () => {
    // 规格：site section 已满足上游聚合阈值，阈值 1 时单标签站点同样建组。
    const plans = planAutoGroups([siteSection('github.com', [makeTab(1)])]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: 'github.com', tabIds: [1] });
  });

  it('本地站点：端口不同即不同站点，不并入同名既有组', () => {
    // 本地站点身份包含端口；端口不同的 localhost 标签不归入同一站点组。
    const plans = planAutoGroups([
      {
        kind: 'site',
        key: 'site-localhost:3000',
        title: 'localhost:3000',
        siteKey: 'localhost:3000',
        mergedGroupIds: [7],
        tabs: [
          makeTab(1, { url: 'http://localhost:3000/a', groupId: 7 }),
          makeTab(2, { url: 'http://localhost:8080/b', groupId: NO_GROUP })
        ]
      }
    ]);
    // 8080 不是 3000 的同站点成员：无可吸收标签，不应产出计划。
    expect(plans).toHaveLength(0);
  });

  it('单标签语言分组不产出计划（噪音）', () => {
    const langSection: TemporarySection = {
      kind: 'site',
      key: 'site-lang:en',
      title: 'English',
      tabs: [makeTab(1)],
      siteKey: 'lang:en'
    };
    expect(planAutoGroups([langSection])).toHaveLength(0);
    // planRegroup（options 形式，内部派生语言 section）同样不下发单标签语言组
    expect(
      planRegroup({ tabs: [makeTab(1, { language: 'en' })], groupMode: 'language' }).plans
    ).toHaveLength(0);
  });

  it('分组信息不可知的标签不参与新建原生组（跨窗口搜索 / 组查询降级兜底）', () => {
    // 这些标签的原生组归属未知；为避免改变其归属，不生成新建组计划。
    const plans = planAutoGroups([
      siteSection('github.com', [
        makeTab(1, { windowId: 2, groupId: 9 }),
        makeTab(2, { windowId: 2, groupId: 9 })
      ])
    ]);
    expect(plans).toEqual([]);
  });

  it('混入分组信息不可知的标签时整组跳过，普通未分组分区照常建组', () => {
    const plans = planAutoGroups([
      siteSection('github.com', [makeTab(1), makeTab(2, { groupId: 9 })]),
      siteSection('notion.so', [makeTab(3), makeTab(4)])
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: 'notion.so', tabIds: [3, 4] });
    expect(plans[0]?.absorbIntoGroupId).toBeUndefined();
  });

  it('存在已入原生组的标签时整组跳过（不打扰手动分组）', () => {
    const plans = planAutoGroups([
      siteSection('github.com', [makeTab(1), makeTab(2, { groupId: 7 })])
    ]);
    expect(plans).toHaveLength(0);
  });

  it('只处理 site 类型 section（原生组/未分组/pinned 跳过）', () => {
    const pinned: TemporarySection = {
      kind: 'pinned',
      key: 'pinned',
      title: '固定标签',
      tabs: [makeTab(1), makeTab(2)]
    };
    const native: TemporarySection = {
      kind: 'native',
      key: 'group-1',
      title: 'Manual',
      tabs: [makeTab(3), makeTab(4)],
      groupId: 1,
      collapsed: false
    };
    const plans = planAutoGroups([pinned, native, siteSection('en', [makeTab(5), makeTab(6)])]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.title).toBe('en');
  });
});

describe('planAutoGroupDomainCorrections（自动组成员归属校正）', () => {
  function nativeSection(title: string, tabs: TabRecord[], groupId = 7): TemporarySection {
    return { kind: 'native', key: `group-${groupId}`, title, tabs, groupId, collapsed: false };
  }

  it('自动组内出现异域名成员时只移出异域标签', () => {
    const corrections = planAutoGroupDomainCorrections(
      [
        nativeSection('github.com', [
          makeTab(1, { url: 'https://github.com/a', groupId: 7 }),
          makeTab(2, { url: 'https://notion.so/x', groupId: 7 })
        ])
      ],
      new Set([7])
    );
    expect(corrections).toEqual([{ groupId: 7, title: 'github.com', tabIds: [2] }]);
  });

  it('非自动组（用户手动建的组）绝不校正，即使标题就是域名', () => {
    const corrections = planAutoGroupDomainCorrections(
      [
        nativeSection('github.com', [
          makeTab(1, { url: 'https://github.com/a', groupId: 7 }),
          makeTab(2, { url: 'https://notion.so/x', groupId: 7 })
        ])
      ],
      new Set<number>()
    );
    expect(corrections).toHaveLength(0);
  });

  it('组标题与站点名不符时跳过校正', () => {
    const corrections = planAutoGroupDomainCorrections(
      [
        nativeSection('工作', [
          makeTab(1, { url: 'https://github.com/a', groupId: 7 }),
          makeTab(2, { url: 'https://notion.so/x', groupId: 7 })
        ])
      ],
      new Set([7])
    );
    expect(corrections).toHaveLength(0);
  });

  it('加载中（url 为空）的成员不参与判定：避免误移出同域新标签', () => {
    const corrections = planAutoGroupDomainCorrections(
      [
        nativeSection('github.com', [
          makeTab(1, { url: 'https://github.com/a', groupId: 7 }),
          makeTab(2, { url: '', groupId: 7 })
        ])
      ],
      new Set([7])
    );
    expect(corrections).toHaveLength(0);
  });

  it('www 归一化后同站点不校正；子域不同按「一子域一组」口径移出', () => {
    const sameSite = planAutoGroupDomainCorrections(
      [
        nativeSection('github.com', [
          makeTab(1, { url: 'https://github.com/a', groupId: 7 }),
          makeTab(2, { url: 'https://www.github.com/b', groupId: 7 })
        ])
      ],
      new Set([7])
    );
    expect(sameSite).toHaveLength(0);

    const subdomain = planAutoGroupDomainCorrections(
      [
        nativeSection('github.com', [
          makeTab(1, { url: 'https://github.com/a', groupId: 7 }),
          makeTab(2, { url: 'https://gist.github.com/b', groupId: 7 })
        ])
      ],
      new Set([7])
    );
    expect(subdomain).toEqual([{ groupId: 7, title: 'github.com', tabIds: [2] }]);
  });

  it('本地站点按含端口的口径比对（组标题与建组时一致）', () => {
    const corrections = planAutoGroupDomainCorrections(
      [
        nativeSection('localhost:3000', [
          makeTab(1, { url: 'http://localhost:3000/a', groupId: 7 }),
          makeTab(2, { url: 'http://localhost:8080/b', groupId: 7 })
        ])
      ],
      new Set([7])
    );
    expect(corrections).toEqual([{ groupId: 7, title: 'localhost:3000', tabIds: [2] }]);
  });
});

describe('planRegroup（完全重新初始化）', () => {
  it('已在原生组内的标签列入打散集合，并参与重新聚合', () => {
    const tabs = [
      makeTab(1, { url: 'https://a.com/1' }),
      makeTab(2, { url: 'https://a.com/2', groupId: 7 }),
      makeTab(3, { url: 'https://b.com/1' })
    ];
    const plan = planRegroup({ tabs });
    // tab 2 已在组 7：需要被打散
    expect(plan.ungroupTabIds).toContain(2);
    // a.com 两个标签重新聚合为一个站点组计划
    expect(plan.plans).toHaveLength(1);
    expect(plan.plans[0]!.title).toBe('a.com');
    expect(plan.plans[0]!.tabIds.sort()).toEqual([1, 2]);
  });

  it('固定标签与固定空间绑定标签不参与（临时区之外）', () => {
    const tabs = [
      makeTab(1, { url: 'https://a.com/1' }),
      makeTab(2, { url: 'https://a.com/2', pinned: true }),
      makeTab(3, { url: 'https://a.com/3' })
    ];
    const plan = planRegroup({ tabs, excludedTabIds: new Set([3]) });
    // 固定标签 2 与排除标签 3 都不出现在任何计划中
    expect(plan.ungroupTabIds).not.toContain(2);
    const planned = plan.plans.flatMap((p) => p.tabIds);
    expect(planned).not.toContain(2);
    expect(planned).not.toContain(3);
    // 仅剩 1 个候选标签，达不到成组阈值 → 无计划
    expect(plan.plans).toHaveLength(0);
  });

  it('opener 模式：plans 为空但已完成打散（层级无法表达为原生组）', () => {
    const tabs = [
      makeTab(1, { url: 'https://a.com/1', groupId: 7 }),
      makeTab(2, { url: 'https://a.com/2', groupId: 7 })
    ];
    const plan = planRegroup({ tabs, groupMode: 'opener' });
    expect(plan.ungroupTabIds.sort()).toEqual([1, 2]);
    expect(plan.plans).toHaveLength(0);
  });

  it('language 模式：同语言标签聚合为语言组计划', () => {
    const tabs = [
      makeTab(1, { url: 'https://a.com/1', language: 'zh-CN' }),
      makeTab(2, { url: 'https://b.com/2', language: 'zh-CN' }),
      makeTab(3, { url: 'https://c.com/3', language: 'en' })
    ];
    const plan = planRegroup({ tabs, groupMode: 'language' });
    expect(plan.plans).toHaveLength(1);
    expect(plan.plans[0]!.title).toBe('中文（简体）');
    expect(plan.plans[0]!.tabIds.sort()).toEqual([1, 2]);
  });

  it('全部已按聚合方式分组时仍产出打散+重建（重新初始化语义）', () => {
    const tabs = [
      makeTab(1, { url: 'https://a.com/1', groupId: 7 }),
      makeTab(2, { url: 'https://a.com/2', groupId: 7 })
    ];
    const plan = planRegroup({ tabs });
    expect(plan.ungroupTabIds.sort()).toEqual([1, 2]);
    expect(plan.plans).toHaveLength(1);
  });
});

describe('groupColorForLabel', () => {
  it('同一标题颜色稳定', () => {
    expect(groupColorForLabel('github.com')).toBe(groupColorForLabel('github.com'));
  });

  it('颜色取自自动分组色板：与全部合法色同源、且不含 grey', () => {
    // 自动分组色板由合法组色中排除 grey 后得到。
    expect(AUTO_GROUP_COLOR_NAMES).toEqual(GROUP_COLOR_NAMES.filter((name) => name !== 'grey'));
    // grey 是 Chrome 新建组的默认色，留给手动建组；自动分组用它会让用户分不清
    // 「这个组是我建的还是扩展建的」。
    expect(AUTO_GROUP_COLOR_NAMES).not.toContain('grey');
    for (const label of ['github.com', 'zh-CN', 'a.com', 'b.io', 'c.net']) {
      expect(AUTO_GROUP_COLOR_NAMES).toContain(groupColorForLabel(label));
    }
  });
});
