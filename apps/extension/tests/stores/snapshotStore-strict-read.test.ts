// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Snapshot } from '@/core/schema/models';
import { snapshotsRepository } from '@/platform/storage/repositories';
import { useSnapshotStore } from '@/stores/snapshotStore';

const snapshot: Snapshot = {
  id: 's1',
  name: '旧名称',
  origin: 'manual',
  createdAt: 1,
  windowId: 1,
  tabCount: 1,
  tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }]
};

beforeEach(async () => {
  await snapshotsRepository.write([snapshot]);
  useSnapshotStore.setState({ snapshots: [snapshot], ready: true });
});

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('快照写前严格读取', () => {
  it('删除基线读取故障时不写空表，磁盘与内存均保留原快照', async () => {
    vi.spyOn(snapshotsRepository, 'readStrict').mockRejectedValue(new Error('storage down'));
    const write = vi.spyOn(snapshotsRepository, 'write');

    await expect(useSnapshotStore.getState().deleteSnapshot(snapshot.id)).rejects.toThrow(
      'storage down'
    );

    expect(write).not.toHaveBeenCalled();
    expect(useSnapshotStore.getState().snapshots).toEqual([snapshot]);
    const stored = await fakeBrowser.storage.local.get('tabs.snapshots.v1');
    expect(stored['tabs.snapshots.v1']).toEqual([snapshot]);
  });

  it('重命名基线读取故障时不写盘也不更新内存', async () => {
    vi.spyOn(snapshotsRepository, 'readStrict').mockRejectedValue(new Error('storage down'));
    const write = vi.spyOn(snapshotsRepository, 'write');

    await expect(useSnapshotStore.getState().renameSnapshot(snapshot.id, '新名称')).rejects.toThrow(
      'storage down'
    );

    expect(write).not.toHaveBeenCalled();
    expect(useSnapshotStore.getState().snapshots).toEqual([snapshot]);
  });
});
