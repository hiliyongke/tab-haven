import { beforeEach, describe, expect, it, vi } from 'vitest';
// 静态导入依赖，使用下方 vi.mock 提供的测试桩。
import { queryWindowTabs } from '@/platform/tabs';
import { restoreSnapshot } from '@/platform/snapshot/snapshots';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * 快照恢复撤销行为规格：仅将本次恢复新建的标签登记为 kind='restore' 的撤销批次；
 * 恢复前标签状态不可用时不创建撤销批次。
 */

const createdIds: number[] = [];

vi.mock('@/platform/tabs', () => ({
  queryCurrentWindowTabs: vi.fn(),
  queryWindowGroups: vi.fn().mockResolvedValue([]),
  closeTabs: vi.fn().mockResolvedValue(undefined),
  // 差分必须落在恢复的目标窗口上（跨窗恢复时侧边栏所在窗口未必是它）。
  queryWindowTabs: vi.fn(),
  resolveRestoreWindowId: vi.fn().mockResolvedValue(1)
}));

vi.mock('@/platform/snapshot/snapshots', () => ({
  restoreSnapshot: vi.fn().mockImplementation(async () => {
    createdIds.length = 0;
    createdIds.push(901, 902);
    return { count: 2, degraded: false };
  }),
  buildSnapshot: vi.fn(),
  collectSnapshotTabs: vi.fn(),
  parseOneTab: vi.fn(),
  persistSnapshot: vi.fn(),
  replaceSpaceSnapshot: vi.fn(),
  // 提供快照淘汰监听器桩。
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

describe('snapshotStore.restore 撤销行为', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('恢复后把本次新建的标签记为 kind=restore 的撤销批次', async () => {
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

    const { count } = await useSnapshotStore.getState().restore('s1');
    expect(count).toBe(2);
    expect(recordClosedBatch).toHaveBeenCalledTimes(1);

    const [recorded, kind] = recordClosedBatch.mock.calls[0]!;
    expect(kind).toBe('restore');
    // 只含新建的两个，不含恢复前就存在的 100
    expect(recorded.map((t: { id: number }) => t.id)).toEqual([901, 902]);
  });

  it('无新建（恢复 0 条）时不记录撤销批次', async () => {
    vi.mocked(restoreSnapshot).mockResolvedValueOnce({ count: 0, degraded: false });
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

  it('无法读取恢复前标签状态时不记录撤销批次', async () => {
    vi.mocked(restoreSnapshot).mockResolvedValueOnce({ count: 2, degraded: false });
    // 恢复前状态不可用时，无法确定哪些标签由本次恢复新建。
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

    const { count } = await useSnapshotStore.getState().restore('s3');
    // 恢复返回成功数量，不创建撤销批次。
    expect(count).toBe(2);
    expect(recordClosedBatch).not.toHaveBeenCalled();
  });
});
