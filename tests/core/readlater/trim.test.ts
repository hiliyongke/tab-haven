import { describe, expect, it } from 'vitest';
import { trimReadLater } from '@/core/readlater/trim';
import type { ReadLaterItem } from '@/core/schema/models';

/** 造条目（addedAt 即排序键）。 */
function item(addedAt: number): ReadLaterItem {
  return { id: `r${addedAt}`, url: `https://a.com/${addedAt}`, title: 'A', addedAt };
}

describe('trimReadLater（容量裁剪淘汰最旧）', () => {
  it('未超限时原样返回（不重排）', () => {
    const list = [item(3), item(1), item(2)];
    expect(trimReadLater(list, 5)).toEqual(list);
  });

  it('超限时淘汰最旧，保留最新加入的条目', () => {
    // 新条目 addedAt 更大：不能像 slice(0, limit) 那样把它切掉
    const list = [item(1), item(2), item(3), item(4)];
    const trimmed = trimReadLater(list, 2);

    expect(trimmed.map((entry) => entry.addedAt)).toEqual([3, 4]);
  });

  it('恰好等于上限时不裁剪', () => {
    const list = [item(1), item(2)];
    expect(trimReadLater(list, 2)).toHaveLength(2);
  });

  it('不修改传入数组', () => {
    const list = [item(2), item(1)];
    trimReadLater(list, 1);
    expect(list).toHaveLength(2);
  });
});
