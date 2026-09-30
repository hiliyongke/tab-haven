// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Snapshot } from '@/core/schema/models';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { persistSnapshot } from '@/platform/snapshot/snapshots';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 快照超限淘汰的**用户可见性**（R18 / S-3）。
 *
 * 此前 trimSnapshots 是纯函数、没有通知通道：超过 snapshotLimit（或自动快照超过
 * maxAutoSnapshots）时最旧的快照被静默丢弃，用户只在打开列表时才发现旧快照不见了。
 * 该性质与撤销栈不同 —— 撤销栈深度是**已披露且用户可调**的设置，缺的只是「淘汰
 * 那一刻」的告知；快照这两条上限此前没有任何运行时告知。
 *
 * 契约：persistSnapshot 把淘汰数交给注册的监听方（platform 层不做 UI 反馈）。
 */

const snap = (id: string, origin: 'auto' | 'manual', createdAt: number): Snapshot =>
  ({
    id,
    name: id,
    origin,
    createdAt,
    tabCount: 0,
    tabs: []
  }) as Snapshot;

describe('快照淘汰告知（S-3）', () => {
  beforeEach(() => {
    useUndoStore.setState({ batches: [], redoBatches: [], toast: null, ready: false });
  });

  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('总数超 snapshotLimit 时淘汰最旧的，并只保留 limit 份', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, snapshotLimit: 2 });
    // 预置 2 份旧的手动快照，再存 1 份新的 → 总数 3 超上限 2，淘汰最旧 1 份。
    await snapshotsRepository.write([snap('old1', 'manual', 1), snap('old2', 'manual', 2)]);

    const next = await persistSnapshot(snap('new', 'manual', 3));

    expect(next).toHaveLength(2);
    expect(next.map((s) => s.id).sort()).toEqual(['new', 'old2']);
  });

  it('未超限时保留全部，且不触发淘汰监听', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, snapshotLimit: 10 });
    await snapshotsRepository.write([snap('a', 'manual', 1)]);
    const evicted: number[] = [];
    const { setSnapshotEvictionListener } = await import('@/platform/snapshot/snapshots');
    setSnapshotEvictionListener((n) => evicted.push(n));

    const next = await persistSnapshot(snap('b', 'manual', 2));

    expect(next).toHaveLength(2);
    expect(evicted).toEqual([]);
  });

  it('超限时把淘汰数量交给监听方（platform 层不自行弹 UI）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, snapshotLimit: 2 });
    await snapshotsRepository.write([snap('old1', 'manual', 1), snap('old2', 'manual', 2)]);

    const counts: number[] = [];
    const { setSnapshotEvictionListener } = await import('@/platform/snapshot/snapshots');
    setSnapshotEvictionListener((n) => counts.push(n));

    await persistSnapshot(snap('new', 'manual', 3));

    expect(counts).toEqual([1]);
  });

  it('自动快照超 maxAutoSnapshots 也会淘汰并告知', async () => {
    await settingsRepository.write({
      ...DEFAULT_SETTINGS,
      snapshotLimit: 20,
      maxAutoSnapshots: 1
    });
    await snapshotsRepository.write([snap('auto1', 'auto', 1)]);

    const counts: number[] = [];
    const { setSnapshotEvictionListener } = await import('@/platform/snapshot/snapshots');
    setSnapshotEvictionListener((n) => counts.push(n));

    const next = await persistSnapshot(snap('auto2', 'auto', 2));

    // 只留最新的 1 份 auto，旧的 auto1 被淘汰
    expect(next.filter((s) => s.origin === 'auto').map((s) => s.id)).toEqual(['auto2']);
    expect(counts).toEqual([1]);
  });
});
