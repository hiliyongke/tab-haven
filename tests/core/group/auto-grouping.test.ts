import { describe, expect, it } from 'vitest';
import { groupColorForLabel, planAutoGroups, planRegroup } from '@/core/group/AutoGrouping';
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
    siteKey: title,
    subgroups: []
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

  it('单标签语言分组不产出计划（噪音）', () => {
    const langSection: TemporarySection = {
      kind: 'site',
      key: 'site-lang-en',
      title: 'English',
      tabs: [makeTab(1)],
      siteKey: 'lang-en',
      subgroups: []
    };
    expect(planAutoGroups([langSection])).toHaveLength(0);
    // planRegroup（options 形式，内部派生语言 section）同样不下发单标签语言组
    expect(
      planRegroup({ tabs: [makeTab(1, { language: 'en' })], groupMode: 'language' }).plans
    ).toHaveLength(0);
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

  it('颜色是合法枚举且不含 grey', () => {
    const valid = new Set(['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
    for (const label of ['github.com', 'zh-CN', 'a.com', 'b.io', 'c.net']) {
      expect(valid.has(groupColorForLabel(label))).toBe(true);
    }
  });
});
