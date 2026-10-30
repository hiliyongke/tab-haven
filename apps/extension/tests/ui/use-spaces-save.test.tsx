// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import * as tabsPlatform from '@/platform/tabs';
import type { Snapshot } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSpaces } from '@/entrypoints/sidepanel/hooks/useSpaces';
import { translate } from '@/i18n';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
    // 将保存结果设为 undefined，表示当前窗口没有可保存的标签。
    const saveSpace = vi
      .spyOn(useSnapshotStore.getState(), 'saveSpace')
      .mockResolvedValue(undefined);
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

  it('保存成功时：激活返回的新空间并提示成功', async () => {
    const oldSpace = space('old', 1000);
    const newSpace = space('new', 2000);
    // 保存成功后列表包含新建的工作区。
    vi.spyOn(useSnapshotStore.getState(), 'saveSpace').mockImplementation(async () => {
      useSnapshotStore.setState({ snapshots: [oldSpace, newSpace] });
      return newSpace.id;
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

  it('新空间激活写盘失败时不发送保存成功回执', async () => {
    const oldSpace = space('old', 1000);
    const newSpace = space('new', 2000);
    vi.spyOn(useSnapshotStore.getState(), 'saveSpace').mockImplementation(async () => {
      useSnapshotStore.setState({ snapshots: [oldSpace, newSpace] });
      return newSpace.id;
    });
    const tryUpdateSettings = vi
      .spyOn(useDataStore.getState(), 'tryUpdateSettings')
      .mockResolvedValue(false);
    const notify = vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const notifyError = vi
      .spyOn(useUndoStore.getState(), 'notifyError')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    await act(async () => {
      result.current.saveAsSpace();
    });

    expect(tryUpdateSettings).toHaveBeenCalledWith({ activeSpaceId: 'new' });
    expect(notify).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it('保存在途时忽略重复点击，完成后允许再次保存', async () => {
    const pendingSave = deferred<string | undefined>();
    const saveSpace = vi
      .spyOn(useSnapshotStore.getState(), 'saveSpace')
      .mockReturnValue(pendingSave.promise);
    vi.spyOn(useDataStore.getState(), 'tryUpdateSettings').mockResolvedValue(true);
    const notify = vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    act(() => {
      result.current.saveAsSpace();
      result.current.saveAsSpace();
    });
    expect(saveSpace).toHaveBeenCalledTimes(1);

    await act(async () => pendingSave.resolve('saved'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(translate('已保存工作区')));
    act(() => result.current.saveAsSpace());
    await waitFor(() => expect(saveSpace).toHaveBeenCalledTimes(2));
  });

  it('保存期间出现更新的其他空间时仍激活本次返回 id', async () => {
    const mine = space('mine', 2000);
    const unrelated = space('unrelated', 3000);
    const pendingSave = deferred<string | undefined>();
    vi.spyOn(useSnapshotStore.getState(), 'saveSpace').mockReturnValue(pendingSave.promise);
    const tryUpdateSettings = vi
      .spyOn(useDataStore.getState(), 'tryUpdateSettings')
      .mockResolvedValue(true);
    vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    act(() => result.current.saveAsSpace());
    useSnapshotStore.setState({ snapshots: [mine, unrelated] });
    await act(async () => pendingSave.resolve(mine.id));

    await waitFor(() => expect(tryUpdateSettings).toHaveBeenCalledWith({ activeSpaceId: 'mine' }));
    expect(tryUpdateSettings).not.toHaveBeenCalledWith({ activeSpaceId: 'unrelated' });
  });
});

describe('useSpaces.switchSpace 重入守卫', () => {
  const restored = { count: 1, degraded: false, createdTabs: [] };
  const threeClosableTabs = [
    { id: 1, windowId: 1, pinned: false, incognito: false, url: 'https://a.com' },
    { id: 2, windowId: 1, pinned: false, incognito: false, url: 'https://b.com' },
    { id: 3, windowId: 1, pinned: false, incognito: false, url: 'https://c.com' }
  ] as never;

  it('准备期连点不同目标时只执行第一次切换', async () => {
    const first = space('first', 1000);
    const second = space('second', 2000);
    useSnapshotStore.setState({ snapshots: [first, second] });
    useDataStore.setState({
      settings: { ...useDataStore.getState().settings, activeSpaceId: undefined }
    });
    const firstQuery = deferred<never[]>();
    const query = vi
      .spyOn(tabsPlatform, 'queryCurrentWindowTabs')
      .mockImplementationOnce(() => firstQuery.promise)
      .mockResolvedValue([]);
    const restore = vi.spyOn(useSnapshotStore.getState(), 'restore').mockResolvedValue(restored);
    vi.spyOn(useDataStore.getState(), 'tryUpdateSettings').mockResolvedValue(true);
    vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    act(() => {
      result.current.switchSpace(first);
      result.current.switchSpace(second);
    });

    expect(query).toHaveBeenCalledTimes(1);
    await act(async () => firstQuery.resolve([]));
    await waitFor(() => expect(restore).toHaveBeenCalledWith('first', undefined));
    expect(restore).not.toHaveBeenCalledWith('second', undefined);
    await waitFor(() => expect(result.current.switching).toBe(false));
  });

  it('准备期双击同一目标时只查询一次影响面', async () => {
    const target = space('target', 1000);
    useSnapshotStore.setState({ snapshots: [target] });
    useDataStore.setState({
      settings: { ...useDataStore.getState().settings, activeSpaceId: undefined }
    });
    const firstQuery = deferred<never[]>();
    const query = vi
      .spyOn(tabsPlatform, 'queryCurrentWindowTabs')
      .mockImplementationOnce(() => firstQuery.promise)
      .mockResolvedValue([]);
    vi.spyOn(useSnapshotStore.getState(), 'restore').mockResolvedValue(restored);
    vi.spyOn(useDataStore.getState(), 'tryUpdateSettings').mockResolvedValue(true);
    vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    act(() => {
      result.current.switchSpace(target);
      result.current.switchSpace(target);
    });

    expect(query).toHaveBeenCalledTimes(1);
    await act(async () => firstQuery.resolve([]));
    await waitFor(() => expect(result.current.switching).toBe(false));
  });

  it('取消确认后释放守卫并保留原待确认目标', async () => {
    const first = space('first', 1000);
    const second = space('second', 2000);
    useSnapshotStore.setState({ snapshots: [first, second] });
    useDataStore.setState({
      settings: { ...useDataStore.getState().settings, activeSpaceId: undefined }
    });
    const query = vi
      .spyOn(tabsPlatform, 'queryCurrentWindowTabs')
      .mockResolvedValue(threeClosableTabs);
    const { result } = renderHook(() => useSpaces());

    act(() => result.current.switchSpace(first));
    await waitFor(() => expect(result.current.pendingSwitch?.target.id).toBe('first'));
    act(() => result.current.switchSpace(second));
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.current.pendingSwitch?.target.id).toBe('first');

    act(() => result.current.cancelSwitch());
    expect(result.current.switching).toBe(false);
    expect(result.current.pendingSwitch).toBeNull();

    act(() => result.current.switchSpace(second));
    await waitFor(() => expect(result.current.pendingSwitch?.target.id).toBe('second'));
    expect(query).toHaveBeenCalledTimes(2);
    act(() => result.current.cancelSwitch());
  });

  it('确认的执行完成后释放守卫，允许切换另一目标', async () => {
    const first = space('first', 1000);
    const second = space('second', 2000);
    useSnapshotStore.setState({ snapshots: [first, second] });
    useDataStore.setState({
      settings: { ...useDataStore.getState().settings, activeSpaceId: undefined }
    });
    vi.spyOn(tabsPlatform, 'queryCurrentWindowTabs').mockResolvedValue(threeClosableTabs);
    vi.spyOn(useUndoStore.getState(), 'closeWithUndo').mockResolvedValue(undefined);
    vi.spyOn(useSnapshotStore.getState(), 'restore').mockResolvedValue(restored);
    vi.spyOn(useDataStore.getState(), 'tryUpdateSettings').mockResolvedValue(true);
    const notify = vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    act(() => result.current.switchSpace(first));
    await waitFor(() => expect(result.current.pendingSwitch?.target.id).toBe('first'));
    act(() => result.current.confirmSwitch());
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(result.current.switching).toBe(false);

    act(() => result.current.switchSpace(second));
    await waitFor(() => expect(result.current.pendingSwitch?.target.id).toBe('second'));
    act(() => result.current.cancelSwitch());
  });
});

describe('useSpaces 激活态写盘失败', () => {
  it('切换后 activeSpaceId 未保存时不发送切换成功回执', async () => {
    const target = space('target', 2000);
    useSnapshotStore.setState({ snapshots: [target] });
    useDataStore.setState({
      settings: { ...useDataStore.getState().settings, activeSpaceId: undefined }
    });
    vi.spyOn(tabsPlatform, 'queryCurrentWindowTabs').mockResolvedValue([
      { id: 1, windowId: 1, pinned: false, incognito: false, url: 'https://a.com' }
    ] as never);
    vi.spyOn(useSnapshotStore.getState(), 'restore').mockResolvedValue({
      count: 1,
      degraded: false,
      createdTabs: []
    });
    vi.spyOn(useUndoStore.getState(), 'closeWithUndo').mockResolvedValue(undefined);
    const tryUpdateSettings = vi
      .spyOn(useDataStore.getState(), 'tryUpdateSettings')
      .mockResolvedValue(false);
    const notify = vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const notifyError = vi
      .spyOn(useUndoStore.getState(), 'notifyError')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    act(() => result.current.switchSpace(target));

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(tryUpdateSettings).toHaveBeenCalledWith({ activeSpaceId: 'target' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('退出时 activeSpaceId 未清除时不发送退出成功回执', async () => {
    const current = space('current', 1000);
    useSnapshotStore.setState({ snapshots: [current] });
    useDataStore.setState({
      settings: { ...useDataStore.getState().settings, activeSpaceId: current.id }
    });
    const updateSpace = vi
      .spyOn(useSnapshotStore.getState(), 'updateSpace')
      .mockResolvedValue(true);
    const tryUpdateSettings = vi
      .spyOn(useDataStore.getState(), 'tryUpdateSettings')
      .mockResolvedValue(false);
    const notify = vi.spyOn(useUndoStore.getState(), 'notify').mockImplementation(() => undefined);
    const notifyError = vi
      .spyOn(useUndoStore.getState(), 'notifyError')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => useSpaces());

    await act(async () => {
      result.current.exitSpace();
    });

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(updateSpace).toHaveBeenCalledWith('current');
    expect(tryUpdateSettings).toHaveBeenCalledWith({ activeSpaceId: undefined });
    expect(notify).not.toHaveBeenCalled();
  });
});
