import { describe, expect, it } from 'vitest';
import { reorderBlockedReason } from '@/core/site/reorderCapability';

/**
 * 列表内排序的可排序性判定。
 *
 * 这是「界面能拖」与「拖了真生效」之间的唯一口径，两边共用它才不会出现
 * 「看着能拖、拖了没反应」。因此每个分支都必须有断言锁住。
 */
describe('reorderBlockedReason', () => {
  it('默认配置（同步开 + 浏览器顺序）允许排序', () => {
    expect(reorderBlockedReason({ tabOrderSync: true, sortMode: 'browser' })).toBeUndefined();
  });

  it('同步关闭 → sync-off（用户主动关的开关，调用方应静默）', () => {
    expect(reorderBlockedReason({ tabOrderSync: false, sortMode: 'browser' })).toBe('sync-off');
  });

  it('最近访问 → recency（视图语义限制，调用方必须告知而非静默）', () => {
    expect(reorderBlockedReason({ tabOrderSync: true, sortMode: 'recency' })).toBe('recency');
  });

  it('同步关闭优先于 recency：写不回浏览器时排序无从持久化', () => {
    expect(reorderBlockedReason({ tabOrderSync: false, sortMode: 'recency' })).toBe('sync-off');
  });
});
