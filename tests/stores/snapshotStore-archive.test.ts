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
    // 逐条关闭并收集实际成功 id（而非数组整体 remove）：撤销登记必须与
    // 真实关闭结果对齐，否则部分失败时会把从未关闭的标签再开一份。
    expect(removeSpy).toHaveBeenCalledWith(11);

    const batches = useUndoStore.getState().batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]!.kind).toBe('archive');
    expect(batches[0]!.entries[0]!.url).toBe('https://a.com/');
  });

  it('部分标签关闭失败时，撤销只登记实际关闭的标签', async () => {
    // 标签 12 在查询与关闭之间失效：tabs.remove(12) 抛错，只有 11 被关闭。
    tabState.tabs = [
      makeTab({ id: 11, url: 'https://a.com/', title: 'A' }),
      makeTab({ id: 12, index: 1, url: 'https://b.com/', title: 'B' })
    ];
    const removeSpy = vi
      .spyOn(fakeBrowser.tabs, 'remove')
      .mockImplementation(((tabId: number) =>
        tabId === 12 ? Promise.reject(new Error('no such tab')) : Promise.resolve()) as never);

    const count = await useSnapshotStore.getState().archiveCurrentWindow();
    expect(count).toBe(2);
    expect(removeSpy).toHaveBeenCalledTimes(2);

    // 撤销批次只含实际关闭的 11，不制造「从未关闭的 12」的重复标签。
    const batches = useUndoStore.getState().batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]!.entries).toHaveLength(1);
    expect(batches[0]!.entries[0]!.url).toBe('https://a.com/');
  });
});
