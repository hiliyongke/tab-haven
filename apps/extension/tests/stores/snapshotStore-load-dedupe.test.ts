// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { snapshotsRepository } from '@/platform/storage/repositories';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * snapshotStore.load() 的在途去重（S7）。
 *
 * 快照族是本项目最大的读（SNAPSHOTS_LIMIT × SNAPSHOT_TABS_LIMIT，每条标签带
 * base64 favicon）。此前只有 `before` 引用守卫而没有共享 promise，StrictMode 双
 * 挂载与多入口并发会各自发起一次全量读盘 —— 启动耗时翻倍，且多出一个「以旧值
 * 覆盖新值」的窗口。
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
