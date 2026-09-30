import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 快照恢复的可撤销性（R8 / IX-3）。
 *
 * 关键契约：恢复完成后，本次**新建**的标签被记为 kind='restore' 的撤销批次。
 * 于是「撤销本次恢复」= 关闭这批标签，而撤销栈既有语义（⌘Z 重新打开）能再开回来。
 *
 * 另一个要点是**差分精度**：只记「恢复后多出来的 tabId」，不能把窗口里原本就在的
 * 标签误判成恢复出来的 —— 否则撤销会关掉整个窗口，比「不可撤销」更糟。
 */

const createdIds: number[] = [];

vi.mock('@/platform/tabs', () => ({
  queryCurrentWindowTabs: vi.fn(),
  queryCurrentWindowGroups: vi.fn().mockResolvedValue([]),
  closeTabs: vi.fn().mockResolvedValue(undefined),
  // 差分必须落在恢复的目标窗口上（跨窗恢复时侧边栏所在窗口未必是它）。
  queryWindowTabs: vi.fn(),
  resolveRestoreWindowId: vi.fn().mockResolvedValue(1)
}));

vi.mock('@/platform/snapshot/snapshots', () => ({
  restoreSnapshot: vi.fn().mockImplementation(async () => {
    createdIds.length = 0;
    createdIds.push(901, 902);
    return 2;
  }),
  buildSnapshot: vi.fn(),
  collectSnapshotTabs: vi.fn(),
  parseOneTab: vi.fn(),
  persistSnapshot: vi.fn(),
  replaceSpaceSnapshot: vi.fn(),
  // 快照淘汰监听（R18 / S-3）：store 在模块加载时注册，mock 必须提供该导出，
  // 否则 import 期即抛「No export is defined on the mock」。
  setSnapshotEvictionListener: vi.fn(),
  SNAPSHOTS_RMW_LOCK: 'lock'
}));

vi.mock('@/platform/storage/repositories', () => ({
  snapshotsRepository: { watch: vi.fn(), read: vi.fn().mockResolvedValue([]) }
}));

const recordClosedBatch = vi.fn();
vi.mock('@/stores/undoStore', () => ({
  useUndoStore: { getState: () => ({ recordClosedBatch }) }
}));

const tab = (id: number) => ({
  id,
  windowId: 1,
  index: id,
  active: false,
  pinned: false,
  incognito: false,
  url: 'https://a.example/' + id,
  title: 't' + id,
  status: 'complete',
  discarded: false,
  muted: false,
  audible: false,
  groupId: -1
});

describe('snapshotStore.restore 的可撤销性（R8）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('恢复后把本次新建的标签记为 kind=restore 的撤销批次', async () => {
    const { queryWindowTabs } = await import('@/platform/tabs');
    const { useSnapshotStore } = await import('@/stores/snapshotStore');

    // 恢复前窗口里已有 1 个标签（id 100）；恢复后多了 901 / 902。
    vi.mocked(queryWindowTabs)
      .mockResolvedValueOnce([tab(100)] as never)
      .mockResolvedValueOnce([tab(100), tab(901), tab(902)] as never);

    useSnapshotStore.setState({
      snapshots: [
        {
          id: 's1',
          name: 'snap',
          origin: 'manual',
          createdAt: 1,
          windowId: 1,
          tabCount: 2,
          tabs: [
            { url: 'https://a.example/901', title: 't901', pinned: false, muted: false },
            { url: 'https://a.example/902', title: 't902', pinned: false, muted: false }
          ]
        }
      ]
    });

    const count = await useSnapshotStore.getState().restore('s1');
    expect(count).toBe(2);
    expect(recordClosedBatch).toHaveBeenCalledTimes(1);

    const [recorded, kind] = recordClosedBatch.mock.calls[0]!;
    expect(kind).toBe('restore');
    // 只含新建的两个，不含恢复前就存在的 100
    expect(recorded.map((t: { id: number }) => t.id)).toEqual([901, 902]);
  });

  it('无新建（恢复 0 条）时不记录撤销批次', async () => {
    const { queryWindowTabs } = await import('@/platform/tabs');
    const { restoreSnapshot } = await import('@/platform/snapshot/snapshots');
    const { useSnapshotStore } = await import('@/stores/snapshotStore');

    vi.mocked(restoreSnapshot).mockResolvedValueOnce(0);
    vi.mocked(queryWindowTabs).mockResolvedValue([tab(100)] as never);

    useSnapshotStore.setState({
      snapshots: [
        {
          id: 's2',
          name: 'snap2',
          origin: 'manual',
          createdAt: 1,
          windowId: 1,
          tabCount: 1,
          tabs: [{ url: 'https://a.example/901', title: 't901', pinned: false, muted: false }]
        }
      ]
    });

    await useSnapshotStore.getState().restore('s2');
    expect(recordClosedBatch).not.toHaveBeenCalled();
  });

  it('拿不到「恢复前现场」时不记账（否则撤销会关掉整个窗口）', async () => {
    const { queryWindowTabs } = await import('@/platform/tabs');
    const { restoreSnapshot } = await import('@/platform/snapshot/snapshots');
    const { useSnapshotStore } = await import('@/stores/snapshotStore');

    vi.mocked(restoreSnapshot).mockResolvedValueOnce(2);
    // 差分基线为空 = 「窗口里每个标签都是本次新建的」，撤销会把用户原有标签一并关掉。
    vi.mocked(queryWindowTabs).mockRejectedValueOnce(new Error('query failed'));

    useSnapshotStore.setState({
      snapshots: [
        {
          id: 's3',
          name: 'snap3',
          origin: 'manual',
          createdAt: 1,
          windowId: 1,
          tabCount: 2,
          tabs: [
            { url: 'https://a.example/901', title: 't901', pinned: false, muted: false },
            { url: 'https://a.example/902', title: 't902', pinned: false, muted: false }
          ]
        }
      ]
    });

    const count = await useSnapshotStore.getState().restore('s3');
    // 恢复本身照常成功，只是少一个反悔入口
    expect(count).toBe(2);
    expect(recordClosedBatch).not.toHaveBeenCalled();
  });
});
