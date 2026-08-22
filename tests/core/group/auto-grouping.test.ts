import { describe, expect, it } from 'vitest';
import { groupColorForLabel, planAutoGroups } from '@/core/group/AutoGrouping';
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
    const plans = planAutoGroups([
      siteSection('github.com', [makeTab(1), makeTab(2)])
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: 'github.com', tabIds: [1, 2] });
  });

  it('单一标签不产出计划', () => {
    const plans = planAutoGroups([siteSection('github.com', [makeTab(1)])]);
    expect(plans).toHaveLength(0);
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

describe('groupColorForLabel', () => {
  it('同一标题颜色稳定', () => {
    expect(groupColorForLabel('github.com')).toBe(groupColorForLabel('github.com'));
  });

  it('颜色是合法枚举且不含 grey', () => {
    const valid = new Set([
      'blue',
      'red',
      'yellow',
      'green',
      'pink',
      'purple',
      'cyan',
      'orange'
    ]);
    for (const label of ['github.com', 'zh-CN', 'a.com', 'b.io', 'c.net']) {
      expect(valid.has(groupColorForLabel(label))).toBe(true);
    }
  });
});
