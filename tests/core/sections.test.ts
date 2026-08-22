import { describe, expect, it } from 'vitest';
import { deriveTemporarySections } from '@/core/grouping/sections';
import type { TabRecord } from '@/core/tab-types';

function makeTab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

describe('deriveTemporarySections', () => {
  it('pinned 与原生组标签不入临时区', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/1', pinned: true }),
      makeTab({ id: 3, index: 2, url: 'https://c.com/1', groupId: 5 })
    ];
    const sections = deriveTemporarySections(tabs);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe('ungrouped');
    expect(sections[0]?.tabs.map((tab) => tab.id)).toEqual([1]);
  });

  it('同站点聚合为 site section，单标签归未分组', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/2' }),
      makeTab({ id: 3, index: 2, url: 'https://b.com/1' })
    ];
    const sections = deriveTemporarySections(tabs);
    expect(sections[0]?.kind).toBe('site');
    expect(sections[0]?.title).toBe('a.com');
    expect(sections[1]?.kind).toBe('ungrouped');
    expect(sections[1]?.tabs).toHaveLength(1);
  });

  it('空窗口返回空 sections', () => {
    expect(deriveTemporarySections([])).toHaveLength(0);
  });
});
