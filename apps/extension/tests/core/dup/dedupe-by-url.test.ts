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

  it('keeper 取最近激活的那个（冻结的 lastAccessed 不再决定 keeper）', () => {
    // 面板侧 lastAccessed 被冻结在「标签首次出现」的时刻（排序键），两副本同值；
    // 真实的最近激活由 lastActivatedAt 承载。 keeper 必须跟实时值走，否则
    // 「留最近用过的那个」与后台复用引擎（直查浏览器实时值）会选出不同的保留者。
    const keep = rankForKeep([
      makeTab(1, { lastAccessed: 100, lastActivatedAt: 500 }),
      makeTab(2, { lastAccessed: 100, lastActivatedAt: 900 }),
      makeTab(3, { lastAccessed: 100, lastActivatedAt: 700 })
    ]);
    expect(keep?.id).toBe(2);
  });

  it('无 lastActivatedAt 时回退 lastAccessed（合成记录不误判）', () => {
    const keep = rankForKeep([
      makeTab(1, { lastAccessed: 100 }),
      makeTab(2, { lastAccessed: 300 })
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
