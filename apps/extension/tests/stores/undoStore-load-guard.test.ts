// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { UndoBatch } from '@/core/schema/models';
import { createUndoBatch } from '@/core/undo/UndoStack';
import { redoRepository, settingsRepository } from '@/platform/storage/repositories';
import { useUndoStore } from '@/stores/undoStore';

/**
 * load() 的「以内存为准」守卫必须覆盖**两个**栈（S5）。
 *
 * 只守卫 `batches` 时，`redoRepository.read()` 在途期间经 watcher 回放进来的新
 * 重做栈，会被 read 返回的磁盘旧值整表覆盖。重做按 URL 反查关闭标签 —— 旧栈复活
 * 意味着重做可能去关掉与本次撤销无关的标签。
 */

function batch(id: string): UndoBatch {
  return createUndoBatch(
    'close',
    [{ url: `https://${id}.com/`, index: 0, pinned: false, muted: false, groupId: -1 }],
    { windowId: 1, id }
  );
}

beforeEach(async () => {
  await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
  useUndoStore.setState({ batches: [], redoBatches: [], toast: null, ready: false });
});

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('load 的内存优先守卫', () => {
  it('重做栈在 read 在途期间被外部写入：load 完成后内存值胜出（不被磁盘旧值回写）', async () => {
    // Given 磁盘上是旧重做栈，read 在途期间另一页写入了新栈（watcher 已回放进内存）
    const diskRedo = [batch('old')];
    const pushedRedo = [batch('new'), batch('old')];
    vi.spyOn(redoRepository, 'read').mockImplementation(async () => {
      // 模拟 watcher 回放（引用变化）：外部写入发生在 read 完成之前
      useUndoStore.setState({ redoBatches: pushedRedo });
      return diskRedo;
    });
    useUndoStore.setState({ redoBatches: [], ready: false });

    // When
    await useUndoStore.getState().load();

    // Then 内存里是回放进来的新栈，磁盘旧值不得回写覆盖
    expect(useUndoStore.getState().redoBatches).toEqual(pushedRedo);
    expect(useUndoStore.getState().ready).toBe(true);
  });
});
