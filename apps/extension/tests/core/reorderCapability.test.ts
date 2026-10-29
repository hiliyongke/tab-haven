import { describe, expect, it } from 'vitest';
import { reorderBlockedReason } from '@/core/site/reorderCapability';

/**
 * 列表内排序行为规格：同一判定用于界面交互与执行路径，决定排序是否可用及其阻止原因。
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
