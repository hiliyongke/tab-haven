// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabRecord } from '@/core/tab-types';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 归档（archive）事务语义：
 *  - 留档失败必须中止关窗（否则就是一次不可撤销的丢标签）；
 *  - 关闭前登记撤销批次（归档也是关闭动作，关闭后必须有可撤销入口）。
 *
 * 标签查询经 mock 注入：fake-browser 的 windows.getCurrent 无实现，
 * queryCurrentWindowTabs（currentWindow 查询）在其上不可用。
 */
const tabState: { tabs: TabRecord[] } = { tabs: [] };

vi.mock('@/platform/tabs', async () => {
  const actual = await vi.importActual<typeof import('@/platform/tabs')>('@/platform/tabs');
  return {
    ...actual,
    queryCurrentWindowTabs: async () => tabState.tabs,
    queryCurrentWindowGroups: async () => []
  };
});

function makeTab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

describe('snapshotStore 归档事务', () => {
  beforeEach(() => {
    tabState.tabs = [makeTab({ id: 11, url: 'https://a.com/', title: 'A' })];
    useSnapshotStore.setState({ snapshots: [], ready: false });
    useUndoStore.setState({ batches: [], toast: null, ready: false });
    useUndoStore.getState().clearToast();
  });

  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('留档失败时中止关窗，标签保持打开', async () => {
    const removeSpy = vi.spyOn(fakeBrowser.tabs, 'remove');

    // 只让快照仓库写失败：归档的留档环节失效。
    const realSet = fakeBrowser.storage.local.set;
    vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(((
      items: Record<string, unknown>
    ) => {
      if ('tabs.snapshots.v1' in items) return Promise.reject(new Error('quota'));
      return realSet(items);
    }) as never);

    await expect(useSnapshotStore.getState().archiveCurrentWindow()).rejects.toThrow();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(useSnapshotStore.getState().snapshots).toHaveLength(0);
  });

  it('归档成功后登记撤销批次（可从撤销历史恢复）', async () => {
    const removeSpy = vi.spyOn(fakeBrowser.tabs, 'remove');

    const count = await useSnapshotStore.getState().archiveCurrentWindow();
    expect(count).toBe(1);
    expect(removeSpy).toHaveBeenCalledWith([11]);

    const batches = useUndoStore.getState().batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]!.kind).toBe('archive');
    expect(batches[0]!.entries[0]!.url).toBe('https://a.com/');
  });
});
