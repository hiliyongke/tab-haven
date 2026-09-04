// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { TabRecord } from '@/core/tab-types';
import { VirtualRowList } from '@/ui/tabs/VirtualRowList';

/**
 * VirtualRowList 虚拟化规格（性能的结构性保证，PRD 5.1「150 标签无可感知卡顿」的
 * 渲染侧防线）：300 行长列表只挂载可视区 + OVERSCAN 缓冲（O(10) 而非 O(n) 个 DOM
 * 节点），滚动按 translateY 平移窗口；短列表退化为全量渲染。
 *
 * 环境适配：jsdom 无 ResizeObserver / 可靠 rAF，测试注入轻量 stub。
 */

/** 生成 n 个标签（仅 VirtualRowList 用到的字段即可）。 */
function tabsOf(count: number): TabRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    windowId: 1,
    index,
    active: false,
    pinned: false,
    incognito: false,
    url: `https://example.com/${index + 1}`,
    pendingUrl: undefined,
    title: `Tab ${index + 1}`,
    favIconUrl: undefined,
    status: 'complete',
    discarded: false,
    muted: false,
    audible: false,
    groupId: -1,
    splitViewId: undefined,
    lastAccessed: index,
    autoDiscardable: true
  }));
}

beforeAll(() => {
  // jsdom 缺失 API 的最小 stub（仅本测试文件作用域）
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    cb: FrameRequestCallback
  ) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (handle: number) =>
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderVirtual(tabs: TabRecord[], itemSize = 32, maxHeight = 400) {
  const renderRow = vi.fn((tab: TabRecord) => <div>row-{tab.id}</div>);
  const view = render(
    <VirtualRowList tabs={tabs} itemSize={itemSize} maxHeight={maxHeight} renderRow={renderRow} />
  );
  return { view, renderRow };
}

/** 当前挂载的行节点数（虚拟窗口内的实际 DOM 子行）。 */
function mountedRows(view: ReturnType<typeof render>): NodeListOf<HTMLElement> {
  return view.container.querySelectorAll<HTMLElement>('.virtual-row-scroll > div > div > div');
}

describe('VirtualRowList（虚拟化结构规格）', () => {
  it('300 行长列表只挂载少量行（O(可视区+缓冲)，非 O(n)）', async () => {
    const { view } = renderVirtual(tabsOf(300));
    // 初始 viewport=maxHeight 先渲染 ~19 行，ResizeObserver measure（jsdom 视口 0）后收敛到缓冲行数
    await waitFor(() => expect(mountedRows(view)).toHaveLength(6));
    expect(mountedRows(view).length).toBeLessThan(300);
  });

  it('总高度撑满虚拟容器（占位高度 = 行数 × 行高）', () => {
    const { view } = renderVirtual(tabsOf(300));
    // 内部占位 div 高度 300×32=9600，保证滚动条量程正确
    const spacer = view.container.querySelector<HTMLElement>('.virtual-row-scroll > div');
    expect(spacer).not.toBeNull();
    expect(spacer?.style.height).toBe(`${300 * 32}px`);
  });

  it('短列表退化为全量渲染（totalHeight ≤ maxHeight）', async () => {
    const { view } = renderVirtual(tabsOf(3));
    await waitFor(() => expect(mountedRows(view)).toHaveLength(3));
  });

  it('滚动后按偏移平移渲染窗口（translateY 跟随滚动位置）', async () => {
    const { view } = renderVirtual(tabsOf(300));
    const scroller = view.container.querySelector<HTMLElement>('.virtual-row-scroll');
    expect(scroller).not.toBeNull();
    await waitFor(() => expect(mountedRows(view)).toHaveLength(6));

    // 模拟滚动到第 100 行
    scroller!.scrollTop = 100 * 32;
    fireEvent.scroll(scroller!);
    // rAF stub 经 setTimeout 调度，等待一拍让 setState 生效
    await waitFor(() => {
      const translated = view.container.querySelector<HTMLElement>(
        '.virtual-row-scroll > div > div'
      );
      expect(translated?.style.transform).toBe(`translateY(${(100 - 6) * 32}px)`);
    });
    // 平移后仍只挂载少量行
    expect(mountedRows(view).length).toBeLessThan(20);
  });
});
