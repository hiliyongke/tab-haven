import { describe, expect, it } from 'vitest';
import { aggregateBySite } from '@/core/site/SiteGrouping';
import { deriveTemporarySections } from '@/core/site/Sections';
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

/**
 * 行为规格（PRD 附录 C-4 / FR-D3.1/D3.3 相关）：
 *  - 同站点 ≥ 阈值（默认 2）成组；
 *  - 排除集（手动移出）永不聚合；
 *  - 组按首标签位置排序；
 *  - 临时区派生：固定标签与原生组标签不入临时区。
 */
describe('aggregateBySite', () => {
  it('同站点达到默认阈值成组，单标签归独立', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://cloud.tencent.com/a' }),
      makeTab({ id: 2, index: 1, url: 'https://news.tencent.com/b' }),
      makeTab({ id: 3, index: 2, url: 'https://example.com/c' })
    ];
    const { groups, singles } = aggregateBySite(tabs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key.value).toBe('tencent.com');
    expect(groups[0]?.tabs).toHaveLength(2);
    expect(singles.map((tab) => tab.id)).toEqual([3]);
  });

  it('阈值可配置（FR-D3.2 预留）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://b.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/2' }),
      makeTab({ id: 3, index: 2, url: 'https://b.com/3' })
    ];
    const { groups, singles } = aggregateBySite(tabs, { threshold: 3 });
    expect(groups).toHaveLength(1);
    expect(singles).toHaveLength(0);

    const withThreshold4 = aggregateBySite(tabs, { threshold: 4 });
    expect(withThreshold4.groups).toHaveLength(0);
    expect(withThreshold4.singles).toHaveLength(3);
  });

  it('排除集永不聚合', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/2' })
    ];
    const { groups, singles } = aggregateBySite(tabs, { excludedTabIds: new Set([2]) });
    expect(groups).toHaveLength(0);
    expect(singles.map((tab) => tab.id)).toEqual([2, 1]);
  });

  it('组按首标签位置排序', () => {
    const tabs = [
      makeTab({ id: 1, index: 5, url: 'https://z.com/1' }),
      makeTab({ id: 2, index: 6, url: 'https://z.com/2' }),
      makeTab({ id: 3, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 4, index: 1, url: 'https://a.com/2' })
    ];
    const { groups } = aggregateBySite(tabs);
    expect(groups.map((group) => group.key.value)).toEqual(['a.com', 'z.com']);
  });
});

describe('deriveTemporarySections', () => {
  it('固定标签与原生组标签不入临时区', () => {
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

  it('空输入返回空 sections', () => {
    expect(deriveTemporarySections([])).toHaveLength(0);
  });
});
