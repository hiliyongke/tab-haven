// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { UndoBatch } from '@/core/schema/models';
import { createUndoBatch } from '@/core/undo/UndoStack';
import { settingsRepository, undoRepository } from '@/platform/storage/repositories';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 撤销执行互斥行为规格：加载完成前并发触发的撤销请求只恢复一次；按批次 id 撤销时，
 * 即使撤销历史尚未加载，也会先完成加载再执行。
 */

const mocks = vi.hoisted(() => ({
  restore: vi.fn(async () => ({
    count: 1,
    failed: [] as never[],
    skippedAlreadyOpen: [] as never[],
    createdTabIds: [2],
    degraded: false
  }))
}));

vi.mock('@/platform/undo/RestoreEngine', () => ({
  restoreTabRecordsDetailed: mocks.restore
}));

function makeBatch(): UndoBatch {
  return createUndoBatch(
    'close',
    [{ url: 'https://a.com/', index: 0, pinned: false, muted: false, groupId: -1 }],
    { windowId: 1, id: 'batch-1' }
  );
}

/** 真实 load：个别用例会临时替换它（模拟「load 在途」），每个用例前复位。 */
const realLoad = useUndoStore.getState().load;

beforeEach(async () => {
  mocks.restore.mockClear();
  await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
  useUndoStore.setState({
    batches: [],
    redoBatches: [],
    toast: null,
    ready: false,
    load: realLoad
  });
});

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('撤销执行互斥', () => {
  it('ready=false 时同一 tick 连续两次 undo()：同批标签只恢复一次', async () => {
    // Given 磁盘与内存各有一批（load 完成后内存栈仍持有该批次）
    const batch = makeBatch();
    await undoRepository.write([batch]);
    useUndoStore.setState({ batches: [batch], ready: false });

    // When 同一 tick 内连续发起两次撤销（面板秒开后连按 ⌘Z）
    const first = useUndoStore.getState().undo();
    const second = useUndoStore.getState().undo();
    await Promise.all([first, second]);

    // Then 只执行一次恢复，栈只减一个批次
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(useUndoStore.getState().batches).toHaveLength(0);
    expect(useUndoStore.getState().undoing).toBe(false);
  });

  it('persistUndo=false 时同样只恢复一次', async () => {
    // Given 关闭持久化且内存中有待撤销批次
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    const batch = makeBatch();
    useUndoStore.setState({ batches: [batch], ready: false });
    // load 在途期间不得抹掉内存栈（模拟「面板刚挂载、load 尚未回来」）
    useUndoStore.setState({
      load: async () => {
        useUndoStore.setState({ ready: true });
      }
    });

    // When 同一 tick 内连续发起两次撤销
    const first = useUndoStore.getState().undo();
    const second = useUndoStore.getState().undo();
    await Promise.all([first, second]);

    // Then 仍然只恢复一次
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it('undoBatch 在 load 完成前点击：先加载再撤销，不误报「该操作已不存在」', async () => {
    // Given 磁盘存在批次 B，而本页内存栈尚未加载（撤销历史面板的数据来自磁盘）
    const batch = makeBatch();
    await undoRepository.write([batch]);
    useUndoStore.setState({ batches: [], ready: false });

    // When 在 ready=false 时按 id 撤销
    await useUndoStore.getState().undoBatch(batch.id);

    // Then 执行恢复，且提示不报告批次不存在
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(useUndoStore.getState().toast?.message).not.toContain('不存在');
  });
});
