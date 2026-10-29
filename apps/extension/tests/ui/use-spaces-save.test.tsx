// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Snapshot } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSpaces } from '@/entrypoints/sidepanel/hooks/useSpaces';

/**
 * useSpaces.saveAsSpace 行为规格：保存成功时激活新工作区并提示成功；保存失败时不改变
 * 当前工作区，也不发送成功提示。
 */

function space(id: string, createdAt: number): Snapshot {
  return {
    id,
    name: `space-${id}`,
    origin: 'space',
    createdAt,
    windowId: 1,
    tabCount: 1,
    tabs: [{ url: 'https://a.com', title: 'a', pinned: false, muted: false }]
  } as Snapshot;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSpaces.saveAsSpace', () => {
  it('空现场保存失败时不激活空间，也不发送成功提示', async () => {
    // 保留已有工作区，验证保存失败时活动工作区不变。
    const oldSpace = space('old', 1000);
    useSnapshotStore.setState({ snapshots: [oldSpace] });
    // 将保存结果设为 false，表示当前窗口没有可保存的标签。
    const saveSpace = vi.spyOn(useSnapshotStore.getState(), 'saveSpace').mockResolvedValue(false);
    const tryUpdateSettings = vi
      .spyOn(useDataStore.getState(), 'tryUpdateSettings')
      .mockResolvedValue(true);
    const notify = vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const notifyError = vi
      .spyOn(useUndoStore.getState(), 'notifyError')
      .mockImplementation(() => undefined);
    const notifyFailure = vi
      .spyOn(useUndoStore.getState(), 'notifyFailure')
      .mockImplementation(() => undefined);

    const { result } = renderHook(() => useSpaces());
    await act(async () => {
      result.current.saveAsSpace();
    });

    expect(saveSpace).toHaveBeenCalledTimes(1);
    // 保存失败时不切换活动工作区。
    expect(tryUpdateSettings).not.toHaveBeenCalled();
    // 保存失败时不发送成功提示，错误回执由保存流程处理。
    expect(notify).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyFailure).not.toHaveBeenCalled();
  });

  it('保存成功（true）时：激活最新空间并提示成功', async () => {
    const oldSpace = space('old', 1000);
    const newSpace = space('new', 2000);
    // 保存成功后列表包含新建的工作区。
    vi.spyOn(useSnapshotStore.getState(), 'saveSpace').mockImplementation(async () => {
      useSnapshotStore.setState({ snapshots: [oldSpace, newSpace] });
      return true;
    });
    const tryUpdateSettings = vi
      .spyOn(useDataStore.getState(), 'tryUpdateSettings')
      .mockResolvedValue(true);
    const notify = vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);

    const { result } = renderHook(() => useSpaces());
    await act(async () => {
      result.current.saveAsSpace();
    });

    expect(tryUpdateSettings).toHaveBeenCalledWith({ activeSpaceId: 'new' });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
