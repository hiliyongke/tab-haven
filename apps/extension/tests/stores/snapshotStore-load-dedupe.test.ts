// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { snapshotsRepository } from '@/platform/storage/repositories';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * snapshotStore.load() 行为规格：并发调用共享一次读取；一次读取完成后再次调用会重新读取。
 */

beforeEach(() => {
  useSnapshotStore.setState({ snapshots: [], ready: false });
});

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('snapshotStore.load 并发', () => {
  it('同一 tick 并发 3 次 load()：只读盘一次', async () => {
    const readSpy = vi.spyOn(snapshotsRepository, 'read');

    await Promise.all([
      useSnapshotStore.getState().load(),
      useSnapshotStore.getState().load(),
      useSnapshotStore.getState().load()
    ]);

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(useSnapshotStore.getState().ready).toBe(true);
  });

  it('去重不粘住：完成后再次 load 仍重新读盘（跨重启回读语义不变）', async () => {
    const readSpy = vi.spyOn(snapshotsRepository, 'read');

    await useSnapshotStore.getState().load();
    await useSnapshotStore.getState().load();

    expect(readSpy).toHaveBeenCalledTimes(2);
  });
});
