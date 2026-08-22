import { describe, expect, it } from 'vitest';
import {
  duplicateGroups,
  duplicateUrlCounts,
  findReuseTarget,
  preferredExistingTab,
  removableDuplicates
} from '@/core/dupes';
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

describe('duplicateUrlCounts / duplicateGroups', () => {
  const tabs = [
    makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
    makeTab({ id: 2, index: 1, url: 'https://a.com/', active: true }),
    makeTab({ id: 3, index: 2, url: 'https://b.com/' })
  ];

  it('按完整 URL 精确计数', () => {
    expect(duplicateUrlCounts(tabs).get('https://a.com/')).toBe(2);
    expect(duplicateUrlCounts(tabs).get('https://b.com/')).toBe(1);
  });

  it('仅同 URL ≥ 2 成组', () => {
    const groups = duplicateGroups(tabs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});

describe('removableDuplicates（keeper 策略：激活 > 固定 > 最早打开）', () => {
  it('当前激活标签为 keeper', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/', active: true }),
      makeTab({ id: 3, index: 2, url: 'https://a.com/' })
    ];
    const removable = removableDuplicates(tabs);
    expect(removable.map((tab) => tab.id)).toEqual([1, 3]);
  });

  it('无激活时固定标签为 keeper', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/', pinned: true })
    ];
    const removable = removableDuplicates(tabs);
    expect(removable.map((tab) => tab.id)).toEqual([1]);
  });

  it('固定标签（非 keeper）跳过清理', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/', pinned: true }),
      makeTab({ id: 3, index: 2, url: 'https://a.com/', active: true })
    ];
    const removable = removableDuplicates(tabs);
    // keeper = 激活标签(id3)；id2 固定跳过；仅 id1 可清理
    expect(removable.map((tab) => tab.id)).toEqual([1]);
  });

  it('无激活无固定时最早打开为 keeper', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/' }),
      makeTab({ id: 3, index: 2, url: 'https://a.com/' })
    ];
    const removable = removableDuplicates(tabs);
    expect(removable.map((tab) => tab.id)).toEqual([2, 3]);
  });
});

describe('preferredExistingTab / findReuseTarget（复用引擎偏好）', () => {
  it('偏好排序：active > pinned > index > id', () => {
    const candidates = [
      makeTab({ id: 10, index: 5, active: false, pinned: false }),
      makeTab({ id: 3, index: 2, active: false, pinned: true }),
      makeTab({ id: 7, index: 1, active: true, pinned: false })
    ];
    expect(preferredExistingTab(candidates)?.id).toBe(7);

    const noActive = candidates.filter((tab) => !tab.active);
    expect(preferredExistingTab(noActive)?.id).toBe(3);
  });

  it('优先复用 established 标签', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }), // established
      makeTab({ id: 100, index: 1, url: 'https://a.com/' }) // 新开（pending）
    ];
    const target = findReuseTarget(tabs, 100, new Set([100]));
    expect(target?.id).toBe(1);
  });

  it('同时新开的多个标签：id 最小者胜出', () => {
    const tabs = [
      makeTab({ id: 100, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 101, index: 1, url: 'https://a.com/' })
    ];
    const target = findReuseTarget(tabs, 101, new Set([100, 101]));
    expect(target?.id).toBe(100);
    // 当前即最老者：无可复用目标
    expect(findReuseTarget(tabs, 100, new Set([100, 101]))).toBeUndefined();
  });
});
