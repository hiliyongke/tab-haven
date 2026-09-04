import { describe, expect, it } from 'vitest';
import { canSafelyDiscardTab, mergeSnapshotTabs, type TabRecord } from '@/core/tab-types';

const safeTab = {
  active: false,
  pinned: false,
  discarded: false,
  audible: false,
  attention: false,
  status: 'complete',
  autoDiscardable: true
};

describe('canSafelyDiscardTab', () => {
  it('requires a browser-provided lastAccessed timestamp', () => {
    expect(canSafelyDiscardTab(safeTab)).toBe(false);
    expect(canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now() })).toBe(true);
  });

  it('rejects protected tabs', () => {
    expect(canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now(), active: true })).toBe(false);
    expect(canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now(), audible: true })).toBe(
      false
    );
    expect(
      canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now(), autoDiscardable: false })
    ).toBe(false);
  });
});

function makeTab(id: number, partial: Partial<TabRecord> = {}): TabRecord {
  return {
    id,
    windowId: 1,
    index: id,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

describe('mergeSnapshotTabs', () => {
  it('新标签（新 id）保留快照的实时 lastAccessed（打开新页面时一次性就位）', () => {
    const merged = mergeSnapshotTabs(
      [makeTab(1, { lastAccessed: 100 })],
      [makeTab(1, { lastAccessed: 100 }), makeTab(2, { lastAccessed: 999 })]
    );
    expect(merged[1]?.lastAccessed).toBe(999);
  });

  it('既有标签冻结 lastAccessed：激活引发的时间刷新不改变排序键（回归：激活即全量重排）', () => {
    const prev = [
      makeTab(1, { lastAccessed: 100 }),
      makeTab(2, { lastAccessed: 200, active: true })
    ];
    // 用户切回 tab 1：浏览器把其 lastAccessed 刷成 300 并翻转 active
    const merged = mergeSnapshotTabs(prev, [
      makeTab(1, { active: true, lastAccessed: 300 }),
      makeTab(2, { lastAccessed: 200 })
    ]);
    expect(merged[0]?.lastAccessed).toBe(100);
    expect(merged[0]?.active).toBe(true);
    // recency 排序键不变：tab 2（200）仍新于 tab 1（100），列表顺序稳定
  });

  it('URL 未变时保留面板探测的语言', () => {
    const merged = mergeSnapshotTabs(
      [makeTab(1, { url: 'https://a.com/', language: 'zh-CN' })],
      [makeTab(1, { url: 'https://a.com/' })]
    );
    expect(merged[0]?.language).toBe('zh-CN');
  });

  it('URL 变化（已导航）时不保留旧语言，待重新探测', () => {
    const merged = mergeSnapshotTabs(
      [makeTab(1, { url: 'https://a.com/', language: 'zh-CN' })],
      [makeTab(1, { url: 'https://b.com/' })]
    );
    expect(merged[0]?.language).toBeUndefined();
  });
});
