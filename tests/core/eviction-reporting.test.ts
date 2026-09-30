import { describe, expect, it } from 'vitest';
import { trimReadLaterWithEvicted } from '@/core/readlater/trim';
import { pushBatchWithEvicted } from '@/core/undo/UndoStack';
import { trimSnapshotsWithEvicted } from '@/platform/snapshot/snapshots';
import type { Settings } from '@/core/schema/models';

/**
 * 三类「静默淘汰」现在都能把被淘汰项交出去（R18 / S-3）。
 *
 * 纯函数层没有 notify 通道（core 不得依赖 UI/store），因此契约是**返回值**：
 * 精确的淘汰项由调用方负责提示。这里锁死「kept + evicted 无遗漏、无重复」。
 */

const item = (id: string, addedAt: number) => ({
  id,
  url: 'https://a.example/' + id,
  title: id,
  addedAt
});

describe('trimReadLaterWithEvicted', () => {
  it('未超限时淘汰为空', () => {
    const r = trimReadLaterWithEvicted([item('a', 1), item('b', 2)], 200);
    expect(r.evicted).toEqual([]);
    expect(r.kept).toHaveLength(2);
  });

  it('超限时淘汰最旧、保留最新（不能 slice(0,limit)）', () => {
    const r = trimReadLaterWithEvicted([item('old', 1), item('mid', 2), item('new', 3)], 2);
    expect(r.kept.map((i) => i.id)).toEqual(['mid', 'new']);
    expect(r.evicted.map((i) => i.id)).toEqual(['old']);
  });

  it('kept + evicted 恰好覆盖全部入参', () => {
    const input = [item('a', 1), item('b', 2), item('c', 3), item('d', 4)];
    const r = trimReadLaterWithEvicted(input, 2);
    expect(r.kept.length + r.evicted.length).toBe(input.length);
  });
});

const settings: Settings = {
  maxAutoSnapshots: 2,
  snapshotLimit: 3
} as unknown as Settings;

const snap = (id: string, origin: 'auto' | 'manual', createdAt: number) => ({
  id,
  name: id,
  origin,
  createdAt,
  tabCount: 0,
  tabs: []
});

describe('trimSnapshotsWithEvicted', () => {
  it('自动快照超上限时淘汰最旧的 auto', () => {
    const r = trimSnapshotsWithEvicted(
      [snap('a1', 'auto', 1), snap('a2', 'auto', 2), snap('a3', 'auto', 3)],
      settings
    );
    expect(r.evicted.map((s) => s.id)).toContain('a1');
    expect(r.kept.find((s) => s.id === 'a1')).toBeUndefined();
  });

  it('总数超 snapshotLimit 时淘汰最旧', () => {
    const r = trimSnapshotsWithEvicted(
      [
        snap('m1', 'manual', 10),
        snap('m2', 'manual', 20),
        snap('m3', 'manual', 30),
        snap('m4', 'manual', 40)
      ],
      settings
    );
    expect(r.kept).toHaveLength(3);
    expect(r.evicted.map((s) => s.id)).toEqual(['m1']);
  });

  it('kept 按创建时间倒序（防自比较回归）', () => {
    const r = trimSnapshotsWithEvicted(
      [snap('x', 'manual', 1), snap('y', 'manual', 5), snap('z', 'manual', 3)],
      settings
    );
    const times = r.kept.map((s) => s.createdAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

const batch = (id: string) =>
  ({ id, kind: 'close', createdAt: 1, entries: [], windowId: 1 }) as never;

describe('pushBatchWithEvicted', () => {
  it('未超限时无淘汰', () => {
    const r = pushBatchWithEvicted([batch('a')], batch('b'), 10);
    expect(r.evicted).toEqual([]);
    expect(r.kept.map((b: { id: string }) => b.id)).toEqual(['a', 'b']);
  });

  it('超限时淘汰最旧批次', () => {
    const r = pushBatchWithEvicted([batch('a'), batch('b')], batch('c'), 2);
    expect(r.evicted.map((b: { id: string }) => b.id)).toEqual(['a']);
    expect(r.kept.map((b: { id: string }) => b.id)).toEqual(['b', 'c']);
  });

  it('limit 钳到 ≥1：limit=0 时仍保留最新批次', () => {
    const r = pushBatchWithEvicted([], batch('only'), 0);
    expect(r.kept).toHaveLength(1);
  });
});
