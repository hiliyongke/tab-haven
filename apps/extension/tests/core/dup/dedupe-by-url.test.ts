import { describe, expect, it } from 'vitest';
import { rankForKeep } from '@/core/dup/DedupeByUrl';
import type { TabRecord } from '@/core/tab-types';

function makeTab(id: number, partial: Partial<TabRecord> = {}): TabRecord {
  return {
    id,
    windowId: 1,
    index: id,
    active: false,
    pinned: false,
    incognito: false,
    url: `https://example.com/`,
    groupId: -1,
    ...partial
  };
}

describe('rankForKeep（同 URL 保留者）', () => {
  it('lastAccessed 最新者胜出', () => {
    const keep = rankForKeep([
      makeTab(1, { lastAccessed: 100 }),
      makeTab(2, { lastAccessed: 300 }),
      makeTab(3, { lastAccessed: 200 })
    ]);
    expect(keep?.id).toBe(2);
  });

  it('无 lastAccessed 时：激活 > 固定 > 位置靠前 > id 大', () => {
    expect(rankForKeep([makeTab(1, { pinned: true }), makeTab(2, { active: true })])?.id).toBe(2);
    expect(rankForKeep([makeTab(1, { pinned: true }), makeTab(2)])?.id).toBe(1);
    // 同 index 时 id 大者胜出
    expect(rankForKeep([makeTab(1, { index: 0 }), makeTab(2, { index: 0 })])?.id).toBe(2);
  });
});
