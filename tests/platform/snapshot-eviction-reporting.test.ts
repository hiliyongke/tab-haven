import { describe, expect, it } from 'vitest';
import { trimSnapshots, trimSnapshotsWithEvicted } from '@/platform/snapshot/snapshots';
import type { Settings } from '@/core/schema/models';

/**
 * 快照裁剪的淘汰上报（R18 / S-3）。
 *
 * 与 tests/core/eviction-reporting.test.ts 同契约（kept + evicted 无遗漏、无
 * 重复），但按层镜像落在这里：`trimSnapshotsWithEvicted` 属于 platform 层。
 */

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

describe('trimSnapshots 与 WithEvicted 同口径', () => {
  it('两份实现的 kept 必须一致（防裁剪逻辑分叉）', () => {
    const input = [
      snap('a1', 'auto', 1),
      snap('a2', 'auto', 2),
      snap('a3', 'auto', 3),
      snap('m1', 'manual', 10),
      snap('m2', 'manual', 20)
    ];
    const { kept } = trimSnapshotsWithEvicted(input, settings);
    expect(kept.map((s) => s.id)).toEqual(['m2', 'm1', 'a3']);
    // 单返回值版本必须与之同口径（现委托同一实现，防止日后分叉成两种裁剪结果）
    expect(trimSnapshots(input, settings).map((s) => s.id)).toEqual(kept.map((s) => s.id));
  });
});
