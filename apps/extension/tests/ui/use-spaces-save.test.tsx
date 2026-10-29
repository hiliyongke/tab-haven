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
 * useSpaces.saveAsSpace 的回归规格。
 *
 * 背景 bug：saveSpace() 返回 boolean，空现场（只剩内部页）时返回 false 且已由
 * store 自行 notifyError('没有可保存的当前标签')。旧实现用 `.then(() => ...)` 忽略
 * 返回值，保存失败时仍会：① 把「最新 space」误判成一个无关的旧工作区并激活它
 * （activeSpaceId 悬空到别的空间）；② 弹出与错误提示相矛盾的「已保存工作区」。
 * 这两条都是状态污染，必须有回归测试锁住。
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

describe('useSpaces.saveAsSpace（保存结果为 false 时的状态一致性）', () => {
  it('空现场保存失败（false）时：不激活任何空间、不弹成功提示', async () => {
    // 已存在一个旧工作区：修复前会被误判为「刚保存的空间」并激活。
    const oldSpace = space('old', 1000);
    useSnapshotStore.setState({ snapshots: [oldSpace] });
    // 保存成功与否是本测试的开关：先置为 false（空现场）。
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
    // 关键：false 时不得去激活旧工作区（否则 activeSpaceId 悬空到无关空间）
    expect(tryUpdateSettings).not.toHaveBeenCalled();
    // 也不得补一条「已保存工作区」的假成功提示（store 自己已弹错误回执）
    expect(notify).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyFailure).not.toHaveBeenCalled();
  });

  it('保存成功（true）时：激活最新空间并提示成功', async () => {
    const oldSpace = space('old', 1000);
    const newSpace = space('new', 2000);
    // saveSpace 成功后把新空间写进列表（模拟 store 内部 set({snapshots})）。
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
