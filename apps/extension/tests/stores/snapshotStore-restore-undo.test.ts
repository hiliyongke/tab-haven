import { beforeEach, describe, expect, it, vi } from 'vitest';
// 静态导入依赖，使用下方 vi.mock 提供的测试桩。
import { queryWindowTabs } from '@/platform/tabs';
import { restoreSnapshot } from '@/platform/snapshot/snapshots';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * 快照恢复撤销行为规格：仅登记恢复引擎真实返回的 createdTabs，不再查询窗口做前后差分；
 * 实际恢复与撤销统一使用已解析的目标窗口。
 */
vi.mock('@/platform/tabs', () => ({
  queryCurrentWindowTabs: vi.fn(),
  queryWindowGroups: vi.fn().mockResolvedValue([]),
  closeTabs: vi.fn().mockResolvedValue(undefined),
  queryWindowTabs: vi.fn(),
  resolveRestoreWindowId: vi.fn().mockResolvedValue(1)
}));

vi.mock('@/platform/snapshot/snapshots', () => ({
  restoreSnapshot: vi.fn().mockImplementation(async () => ({
    count: 2,
    degraded: false,
    createdTabs: [tab(901), tab(902)]
  })),
  buildSnapshot: vi.fn(),
  collectSnapshotTabs: vi.fn(),
  parseOneTab: vi.fn(),
  persistSnapshot: vi.fn(),
  replaceSpaceSnapshot: vi.fn(),
  buildPartialSnapshot: vi.fn((snapshot, tabs) => ({ ...snapshot, tabs, tabCount: tabs.length })),
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

const snapshot = {
  id: 's1',
  name: 'snap',
  origin: 'manual' as const,
  createdAt: 1,
  windowId: 1,
  tabCount: 2,
  tabs: [
    { url: 'https://a.example/901', title: 't901', pinned: false, muted: false },
    { url: 'https://a.example/902', title: 't902', pinned: false, muted: false }
  ]
};

describe('snapshotStore.restore 撤销行为', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSnapshotStore.setState({ snapshots: [snapshot], ready: true });
  });

  it('只把恢复引擎真实创建的标签记为 kind=restore，且恢复复用目标窗口', async () => {
    const { count } = await useSnapshotStore.getState().restore('s1');

    expect(count).toBe(2);
    expect(vi.mocked(restoreSnapshot).mock.calls[0]?.[1]).toBe(1);
    // 不再读取窗口做差分，恢复期间其它任务创建的标签天然不会混入撤销批次。
    expect(queryWindowTabs).not.toHaveBeenCalled();
    const [recorded, kind] = recordClosedBatch.mock.calls[0]!;
    expect(kind).toBe('restore');
    expect(recorded.map((entry: { id: number }) => entry.id)).toEqual([901, 902]);
  });

  it('无新建（恢复 0 条）时不记录撤销批次', async () => {
    vi.mocked(restoreSnapshot).mockResolvedValueOnce({
      count: 0,
      degraded: false,
      createdTabs: []
    });

    await useSnapshotStore.getState().restore('s1');

    expect(recordClosedBatch).not.toHaveBeenCalled();
  });

  it('选择性恢复同样复用目标窗口，并只登记实际创建项', async () => {
    vi.mocked(restoreSnapshot).mockResolvedValueOnce({
      count: 1,
      degraded: false,
      createdTabs: [tab(901)]
    });

    await useSnapshotStore.getState().restoreSelected('s1', [snapshot.tabs[0]!]);

    expect(vi.mocked(restoreSnapshot).mock.calls[0]?.[1]).toBe(1);
    const [recorded, kind] = recordClosedBatch.mock.calls[0]!;
    expect(kind).toBe('restore');
    expect(recorded.map((entry: { id: number }) => entry.id)).toEqual([901]);
  });
});
