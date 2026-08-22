import { describe, expect, it } from 'vitest';
import { collectWebsiteGroups } from '@/core/grouping/collect';
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

describe('collectWebsiteGroups', () => {
  it('同站点 ≥ 2 成组（默认阈值），单标签归独立', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://cloud.tencent.com/a' }),
      makeTab({ id: 2, index: 1, url: 'https://news.tencent.com/b' }),
      makeTab({ id: 3, index: 2, url: 'https://example.com/c' })
    ];
    const { websiteGroups, standaloneTabs } = collectWebsiteGroups(tabs);
    expect(websiteGroups).toHaveLength(1);
    expect(websiteGroups[0]?.key).toBe('tencent.com');
    expect(websiteGroups[0]?.tabs).toHaveLength(2);
    expect(standaloneTabs.map((tab) => tab.id)).toEqual([3]);
  });

  it('阈值可配置（FR-D3.2 预留接口）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/2' }),
      makeTab({ id: 3, index: 2, url: 'https://b.com/1' }),
      makeTab({ id: 4, index: 3, url: 'https://b.com/2' }),
      makeTab({ id: 5, index: 4, url: 'https://b.com/3' })
    ];
    const grouping = collectWebsiteGroups(tabs, new Set(), 3);
    expect(grouping.websiteGroups).toHaveLength(1);
    expect(grouping.websiteGroups[0]?.key).toBe('b.com');
    expect(grouping.standaloneTabs).toHaveLength(2);
  });

  it('手动移出的标签永不聚合（基线语义）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/2' })
    ];
    const { websiteGroups, standaloneTabs } = collectWebsiteGroups(tabs, new Set([2]));
    expect(websiteGroups).toHaveLength(0);
    // 手动移出的标签先入独立区；未达阈值的单标签最后归入独立区
    expect(standaloneTabs.map((tab) => tab.id)).toEqual([2, 1]);
  });

  it('不可识别 URL（chrome:// 等）归独立', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'chrome://newtab/' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/' })
    ];
    const { websiteGroups, standaloneTabs } = collectWebsiteGroups(tabs);
    expect(websiteGroups).toHaveLength(0);
    expect(standaloneTabs).toHaveLength(2);
  });

  it('分组按组内首标签 index 排序', () => {
    const tabs = [
      makeTab({ id: 1, index: 5, url: 'https://z.com/1' }),
      makeTab({ id: 2, index: 6, url: 'https://z.com/2' }),
      makeTab({ id: 3, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 4, index: 1, url: 'https://a.com/2' })
    ];
    const { websiteGroups } = collectWebsiteGroups(tabs);
    expect(websiteGroups.map((group) => group.key)).toEqual(['a.com', 'z.com']);
  });
});
