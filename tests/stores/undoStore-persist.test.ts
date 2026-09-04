// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository } from '@/platform/storage/repositories';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 撤销栈的持久化往返：`persistUndo` 是「关掉再打开还能撤销」的开关。
 *
 * 此前 persistUndo 的行为只在注释里声明过，没有用例。开关语义一旦退化
 * （比如关闭时不清库、或开启时不回读），用户会看到「上次关掉的标签凭空出现在撤销面板里」。
 */

afterEach(() => {
  fakeBrowser.reset();
  useUndoStore.setState({ batches: [], toast: null, ready: false });
  vi.restoreAllMocks();
});

async function closeOne(url = 'https://a.com/'): Promise<void> {
  await useUndoStore
    .getState()
    .closeWithUndo(
      [{ id: 1, windowId: 1, index: 0, url, title: 'A', pinned: false, groupId: -1 } as never],
      [1]
    );
}

describe('persistUndo 开关语义', () => {
  it('开启时：入栈即落盘，重新 load 可原样读回', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
    await useUndoStore.getState().load();
    await closeOne();

    // 模拟「浏览器重启」：内存态清空后重新 load
    useUndoStore.setState({ batches: [], ready: false });
    await useUndoStore.getState().load();

    const batches = useUndoStore.getState().batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]!.entries[0]!.url).toBe('https://a.com/');
  });

  it('关闭时：入栈不落盘，restart 后撤销栈为空', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    await useUndoStore.getState().load();
    await closeOne();

    useUndoStore.setState({ batches: [], ready: false });
    await useUndoStore.getState().load();

    expect(useUndoStore.getState().batches).toEqual([]);
  });

  it('关闭时会清空历史库（防止上一轮开启时留下的批次复活）', async () => {
    // 先以开启状态写入一批
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
    await useUndoStore.getState().load();
    await closeOne('https://old.com/');

    // 再切到关闭状态并重新加载
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    await useUndoStore.getState().load();

    expect(useUndoStore.getState().batches).toEqual([]);
    const stored = await fakeBrowser.storage.local.get('tabs.undo-stack.v1');
    expect(stored['tabs.undo-stack.v1']).toEqual([]);
  });
});
