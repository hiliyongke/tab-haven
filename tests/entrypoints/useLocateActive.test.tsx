// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocateActive } from '@/entrypoints/sidepanel/useLocateActive';
import { LOCATE_SECTION_EVENT } from '@/ui/tabs/SectionList';
import { LOCATE_SCROLL_EVENT } from '@/ui/tabs/VirtualRowList';
import { LOCATE_TAB_EVENT } from '@/ui/fixed/FixedArea';

// jsdom 未实现滚动 API，定位链路会调用 target.scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * 「定位激活标签」主链路（评审 B6 关键路径）。
 *
 * 这是从 App.tsx 抽出的第一个可独立测试的主控制器单元。
 * 虚拟列表下目标行可能不在渲染窗口内，链路必须靠「发事件 → 重试」兜底；
 * 此前这段逻辑埋在 900 行的组件里，任何改动都无法验证。
 */

const EVENT_TYPES = [LOCATE_SECTION_EVENT, LOCATE_TAB_EVENT, LOCATE_SCROLL_EVENT];

function mountTarget(tabId: number): HTMLElement {
  const li = document.createElement('li');
  li.setAttribute('data-tabs-tab-id', String(tabId));
  const row = document.createElement('div');
  row.className = 'row-item';
  li.appendChild(row);
  document.body.appendChild(li);
  return li;
}

function setup(activeTabId: number | undefined) {
  const notify = vi.fn();
  const clearQuery = vi.fn();
  const t = (key: string) => key;
  const dispatched: string[] = [];
  const listener = (event: Event) => dispatched.push(event.type);
  for (const type of EVENT_TYPES) window.addEventListener(type, listener);

  const { result } = renderHook(() => useLocateActive({ activeTabId, notify, clearQuery, t }));
  return {
    locate: () => act(() => void result.current()),
    notify,
    clearQuery,
    dispatched,
    cleanup: () => {
      for (const type of EVENT_TYPES) window.removeEventListener(type, listener);
      document.body.innerHTML = '';
    }
  };
}

describe('useLocateActive', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('无激活标签：提示后直接返回，不发任何事件', () => {
    const ctx = setup(undefined);
    ctx.locate();
    expect(ctx.notify).toHaveBeenCalledWith('toast.activeTabNotFound');
    expect(ctx.dispatched).toEqual([]);
  });

  it('目标行已在 DOM：直接定位并高亮，不派发兜底事件', () => {
    const li = mountTarget(7);
    const ctx = setup(7);
    ctx.locate();
    const row = li.querySelector<HTMLElement>('.row-item')!;
    expect(row.classList.contains('is-located')).toBe(true);
    expect(ctx.clearQuery).toHaveBeenCalled();
    expect(ctx.dispatched).toEqual([]);
  });

  it('目标行不在 DOM：派发三个定位事件并进入重试链', () => {
    vi.useFakeTimers();
    const ctx = setup(42);
    ctx.locate();
    expect(ctx.dispatched).toEqual(EVENT_TYPES);
    // 重试链：首次 setTimeout(retryLocate, 0) 会再发一轮
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(ctx.dispatched).toEqual([...EVENT_TYPES, ...EVENT_TYPES]);
  });

  it('重试期间目标行挂载：命中即停，不再继续重试', () => {
    vi.useFakeTimers();
    const ctx = setup(42);
    ctx.locate();
    // 第二轮重试前把目标挂进 DOM
    mountTarget(42);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    const before = ctx.dispatched.length;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(ctx.dispatched.length).toBe(before);
  });

  it('新的定位请求会让旧请求的重试链失效（requestId 守卫）', () => {
    vi.useFakeTimers();
    const ctx = setup(42);

    // 先量出「单条链」的完整事件数：3 个同步事件 + 12 轮重试 × 3 事件。
    ctx.locate();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const singleChain = ctx.dispatched.length;

    // 再构造「两条链并存」：第一条链跑到一半时发起第二个请求。
    ctx.dispatched.length = 0;
    ctx.locate();
    act(() => {
      vi.advanceTimersByTime(10);
    });
    ctx.locate();
    const atSecondCall = ctx.dispatched.length;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 守卫生效 → 此后只有第二条链的重试轮次（12 轮 × 3 事件）；
    // 守卫失效 → 第一条链的剩余轮次也会继续跑，增量会明显超过这个数。
    expect(ctx.dispatched.length - atSecondCall).toBe(singleChain - 3);
  });
});
