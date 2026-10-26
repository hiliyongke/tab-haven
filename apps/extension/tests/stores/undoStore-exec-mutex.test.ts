// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { UndoBatch } from '@/core/schema/models';
import { createUndoBatch } from '@/core/undo/UndoStack';
import { settingsRepository, undoRepository } from '@/platform/storage/repositories';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 撤销入口的执行互斥（M3 / S1 + S6）。
 *
 * 入口的 `isExecuting()` 判空发生在 `await get().load()` **之前**，而 `undoing` 的
 * 置位在 `runGuardedUndo` 里（await 之后）。ready=false 时同一 tick 的两次撤销会
 * 各自通过那道判空、各自 await 同一个 loadInFlight、各自 `popBatch` 拿到同一个
 * latest —— 同一批标签被恢复两次。persistUndo=false 时跨页复核整段跳过，那道判空
 * 是唯一拦截，缺口更大。
 *
 * 因此互斥必须是「在 runGuardedUndo 开头 CAS 置位」，而不是「入口判空」。
 */

const mocks = vi.hoisted(() => ({
  restore: vi.fn(async () => ({
    count: 1,
    failed: [] as never[],
    skippedAlreadyOpen: [] as never[],
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

  it('persistUndo=false（跨页复核整段跳过）时同样只恢复一次', async () => {
    // Given 关闭持久化：跨页复核分支不存在，入口判空是唯一拦截
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

    // Then 正常撤销（恢复被调用），而不是给出与事实相反的「已不存在」
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(useUndoStore.getState().toast?.message).not.toContain('不存在');
  });
});
