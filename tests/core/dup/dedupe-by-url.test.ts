import { describe, expect, it } from 'vitest';
import { planUrlDedupe, rankForKeep } from '@/core/dup/DedupeByUrl';
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

describe('planUrlDedupe（同 URL 唯一化计划）', () => {
  it('同 URL 多标签：保留最近访问，其余待关闭', () => {
    const plans = planUrlDedupe([
      makeTab(1, { url: 'https://a.com/', lastAccessed: 100 }),
      makeTab(2, { url: 'https://a.com/', lastAccessed: 300 }),
      makeTab(3, { url: 'https://b.com/', lastAccessed: 500 })
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      keep: expect.objectContaining({ id: 2 }),
      close: expect.arrayContaining([expect.objectContaining({ id: 1 })])
    });
    expect(plans[0]!.close.map((t) => t.id)).toEqual([1]);
  });

  it('URL 判定与复用引擎同口径：完全相同 URL 归组，不同协议不归组', () => {
    // 完全相同 URL → 归组
    const same = planUrlDedupe([
      makeTab(1, { url: 'https://a.com/path' }),
      makeTab(2, { url: 'https://a.com/path' })
    ]);
    expect(same).toHaveLength(1);
    // http/https 或 www 差异 → comparisonKey 不同，不归组（与 ReusePolicy 同口径）
    const different = planUrlDedupe([
      makeTab(1, { url: 'http://www.a.com/' }),
      makeTab(2, { url: 'https://a.com/' })
    ]);
    expect(different).toHaveLength(0);
  });

  it('非 web 页（内部页/空白）不参与唯一化', () => {
    const plans = planUrlDedupe([
      makeTab(1, { url: 'chrome://extensions/' }),
      makeTab(2, { url: 'about:blank' }),
      makeTab(3, { url: 'https://a.com/' })
    ]);
    expect(plans).toHaveLength(0);
  });

  it('单标签不产出计划', () => {
    expect(planUrlDedupe([makeTab(1)])).toHaveLength(0);
  });
});
