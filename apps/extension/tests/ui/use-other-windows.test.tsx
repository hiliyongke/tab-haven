// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { useOtherWindows } from '@/ui/tabs/useOtherWindows';
import { useTabStore } from '@/stores/tabStore';

/** 造一个窗口的标签集。 */
function windowTabs(windowId: number, count: number, activeId = -1): TabRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: windowId * 100 + i,
    windowId,
    index: i,
    active: windowId * 100 + i === activeId,
    pinned: false,
    incognito: false,
    groupId: NO_GROUP,
    title: `W${windowId}-${i}`,
    url: `https://w${windowId}.example.com/${i}`
  }));
}

/** 打桩全窗口查询（fake-browser 的 windowType 过滤不可靠，与 omnibox 测试同口径）。 */
function stubAllTabs(tabs: TabRecord[]) {
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue(tabs as never);
}

beforeEach(() => {
  useTabStore.setState({ currentWindowId: 1 } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useOtherWindows（A4 其他窗口分段）', () => {
  it('过滤当前窗口，其余按窗口分桶、index 排序', async () => {
    stubAllTabs([...windowTabs(1, 2), ...windowTabs(2, 2), ...windowTabs(3, 1)]);

    const { result } = renderHook(() => useOtherWindows(true));
    await vi.waitFor(() => expect(result.current.otherWindows).toHaveLength(2));

    const [first, second] = result.current.otherWindows;
    expect(first!.windowId).toBe(2);
    expect(first!.tabs.map((tab) => tab.id)).toEqual([200, 201]);
    expect(second!.windowId).toBe(3);
  });

  it('含激活标签的窗口排前', async () => {
    stubAllTabs([
      ...windowTabs(1, 1, 100),
      ...windowTabs(2, 2), // 无激活
      ...windowTabs(3, 2, 301) // 含激活
    ]);

    const { result } = renderHook(() => useOtherWindows(true));
    await vi.waitFor(() => expect(result.current.otherWindows).toHaveLength(2));

    expect(result.current.otherWindows[0]!.windowId).toBe(3);
    expect(result.current.otherWindows[0]!.hasActive).toBe(true);
    expect(result.current.otherWindows[1]!.hasActive).toBe(false);
  });

  it('旧查询晚于新查询返回时被丢弃，不覆盖最新窗口快照', async () => {
    vi.useFakeTimers();
    let resolveOld: (tabs: TabRecord[]) => void = () => undefined;
    let resolveCurrent: (tabs: TabRecord[]) => void = () => undefined;
    const oldQuery = new Promise<TabRecord[]>((resolve) => {
      resolveOld = resolve;
    });
    const currentQuery = new Promise<TabRecord[]>((resolve) => {
      resolveCurrent = resolve;
    });
    const query = vi
      .spyOn(fakeBrowser.tabs, 'query')
      .mockReturnValueOnce(oldQuery as never)
      .mockReturnValueOnce(currentQuery as never);
    const { result } = renderHook(() => useOtherWindows(true));
    expect(query).toHaveBeenCalledTimes(1);

    // 首轮仍在途时发生标签事件：节流窗口结束后发起第二轮，而非取消首轮。
    act(() => {
      void fakeBrowser.tabs.onCreated.trigger({} as never);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(query).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveCurrent(windowTabs(3, 1));
      await currentQuery;
    });
    expect(result.current.otherWindows.map((win) => win.windowId)).toEqual([3]);

    await act(async () => {
      resolveOld(windowTabs(2, 1));
      await oldQuery;
    });
    expect(result.current.otherWindows.map((win) => win.windowId)).toEqual([3]);
    expect(result.current.status).toBe('ready');
  });

  it('旧查询晚于新查询失败时被丢弃，不覆盖最新成功状态', async () => {
    vi.useFakeTimers();
    let rejectOld: (error: Error) => void = () => undefined;
    let resolveCurrent: (tabs: TabRecord[]) => void = () => undefined;
    const oldQuery = new Promise<TabRecord[]>((_, reject) => {
      rejectOld = reject;
    });
    const currentQuery = new Promise<TabRecord[]>((resolve) => {
      resolveCurrent = resolve;
    });
    const query = vi
      .spyOn(fakeBrowser.tabs, 'query')
      .mockReturnValueOnce(oldQuery as never)
      .mockReturnValueOnce(currentQuery as never);
    const { result } = renderHook(() => useOtherWindows(true));

    act(() => {
      void fakeBrowser.tabs.onCreated.trigger({} as never);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(query).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveCurrent(windowTabs(3, 1));
      await currentQuery;
    });
    expect(result.current.status).toBe('ready');

    await act(async () => {
      rejectOld(new Error('stale failure'));
      await expect(oldQuery).rejects.toThrow('stale failure');
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.otherWindows.map((win) => win.windowId)).toEqual([3]);
  });

  it('无其他窗口时为空数组', async () => {
    stubAllTabs(windowTabs(1, 3));

    const { result } = renderHook(() => useOtherWindows(true));
    await vi.waitFor(() => expect(result.current.otherWindows).toHaveLength(0));

    expect(result.current.otherWindows).toEqual([]);
  });
});
