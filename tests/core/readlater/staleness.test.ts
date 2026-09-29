import { describe, expect, it } from 'vitest';
import { isReadLaterStale, READLATER_STALE_MS } from '@/core/readlater/staleness';
import type { ReadLaterItem } from '@/core/schema/models';

/** 造一条稍后读条目（默认未读）。 */
function item(partial: Partial<ReadLaterItem>): ReadLaterItem {
  return { id: 'r1', url: 'https://a.com/', title: 'A', addedAt: 1000, ...partial };
}

describe('isReadLaterStale（7 天过期判定）', () => {
  it('未读且超过 7 天 → 过期', () => {
    expect(isReadLaterStale(item({ addedAt: 0 }), READLATER_STALE_MS + 1)).toBe(true);
  });

  it('未读且恰好 7 天（含边界）→ 未过期', () => {
    expect(isReadLaterStale(item({ addedAt: 0 }), READLATER_STALE_MS)).toBe(false);
  });

  it('未读但未满 7 天 → 未过期', () => {
    expect(isReadLaterStale(item({ addedAt: 0 }), READLATER_STALE_MS - 1)).toBe(false);
  });

  it('已读条目永不参与过期提示（读完成灰，由用户手动清理）', () => {
    expect(isReadLaterStale(item({ addedAt: 0, readAt: 500 }), READLATER_STALE_MS + 1)).toBe(false);
  });
});
