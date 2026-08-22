// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type UndoBatch } from '@/core/schema/models';
import { redoRepository, settingsRepository } from '@/platform/storage/repositories';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 重做栈（FIX-03）的持久化语义。
 *
 * 三条不变量：
 *  1. 重做只对「最近一次撤销」有意义 —— 任何新的关闭批次入栈即清空；
 *  2. 清空必须落盘 —— 否则上一轮的重做项会在重启后复活，去关一批无关的标签；
 *  3. 与撤销栈共用 `persistUndo` 开关 —— 关闭时两者都仅会话内有效。
 */

afterEach(() => {
  fakeBrowser.reset();
  useUndoStore.setState({ batches: [], redoBatches: [], toast: null, ready: false });
  vi.restoreAllMocks();
});

const redoBatch = (): UndoBatch => ({
  id: 'redo-1',
  kind: 'close',
  createdAt: 1,
  entries: [{ url: 'https://a.com/', index: 0, pinned: false, muted: false, groupId: -1 }]
});

async function closeOne(url = 'https://b.com/'): Promise<void> {
  await useUndoStore
    .getState()
    .closeWithUndo(
      [{ id: 1, windowId: 1, index: 0, url, title: 'B', pinned: false, groupId: -1 } as never],
      [1]
    );
}

describe('重做栈持久化', () => {
  it('新的关闭批次入栈即清空内存中的重做栈', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
    await useUndoStore.getState().load();
    useUndoStore.setState({ redoBatches: [redoBatch()] });

    await closeOne();

    expect(useUndoStore.getState().redoBatches).toEqual([]);
  });

  it('清空动作会落盘（防止重启后旧重做项复活）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
    await useUndoStore.getState().load();
    await redoRepository.write([redoBatch()]);
    useUndoStore.setState({ redoBatches: [redoBatch()] });

    await closeOne();

    const stored = await fakeBrowser.storage.local.get('tabs.redo-stack.v1');
    expect(stored['tabs.redo-stack.v1']).toEqual([]);
  });

  it('persistUndo 开启时：重做栈可回读（重启后仍可重做）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
    await redoRepository.write([redoBatch()]);

    await useUndoStore.getState().load();

    expect(useUndoStore.getState().redoBatches).toHaveLength(1);
  });

  it('persistUndo 关闭时：重做栈不落盘，重启后为空（与撤销栈同开关）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    await redoRepository.write([redoBatch()]);

    await useUndoStore.getState().load();

    expect(useUndoStore.getState().redoBatches).toEqual([]);
    const stored = await fakeBrowser.storage.local.get('tabs.redo-stack.v1');
    expect(stored['tabs.redo-stack.v1']).toEqual([]);
  });
});
