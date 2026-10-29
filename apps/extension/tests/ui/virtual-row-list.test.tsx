// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { TabRecord } from '@/core/tab-types';
import { VirtualRowList } from '@/ui/tabs/VirtualRowList';

/**
 * VirtualRowList 虚拟化规格（性能的结构性保证，是「150 标签无可感知卡顿」的
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

  it('虚拟化容器保持列表语义（调用方渲染 <li> 时不产生孤儿 li）', () => {
    // 行由调用方渲染，TabRow 根元素是 <li>；虚拟化分支外层没有 <ul>（非虚拟分支
    // 由 sectionCards 提供）——缺 list 语义时读屏会丢失「列表 N 项」与位置播报。
    const view = render(
      <VirtualRowList
        tabs={tabsOf(300)}
        itemSize={32}
        maxHeight={400}
        renderRow={(tab) => <li>row-{tab.id}</li>}
      />
    );

    const list = view.container.querySelector('[role="list"]');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll('li').length).toBeGreaterThan(0);
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

  it('数据源收缩后渲染窗口回到界内（scrollTop 派生时钳到剩余可滚动量）', async () => {
    const renderRow = vi.fn((tab: TabRecord) => <div>row-{tab.id}</div>);
    const view = render(
      <VirtualRowList tabs={tabsOf(100)} itemSize={32} maxHeight={400} renderRow={renderRow} />
    );
    const scroller = view.container.querySelector<HTMLElement>('.virtual-row-scroll');
    expect(scroller).not.toBeNull();
    await waitFor(() => expect(mountedRows(view)).toHaveLength(6));

    // 滚到列表末尾：scrollTop 远超后面 3 条的总高度
    scroller!.scrollTop = 100 * 32;
    fireEvent.scroll(scroller!);
    await waitFor(() => {
      const translated = view.container.querySelector<HTMLElement>(
        '.virtual-row-scroll > div > div'
      );
      expect(translated?.style.transform).toBe(`translateY(${(100 - 6) * 32}px)`);
    });

    // 过滤成 3 条：容器不再有可滚动余量，浏览器不会派发 scroll 来自愈 scrollTop
    view.rerender(
      <VirtualRowList tabs={tabsOf(3)} itemSize={32} maxHeight={400} renderRow={renderRow} />
    );

    // 未钳制时 start 被顶到 2、end=3 —— 只剩最后一行，前两行空白
    await waitFor(() => expect(mountedRows(view)).toHaveLength(3));
  });

  it('根字号缩放变化后重新校准实测行高（不沿用旧 measuredSize）', async () => {
    // 背景：measuredSize 一旦经首行实测赋值，测量 effect 的
    // `if (measuredSize !== null) return` 就永不重测；只有把它置回 null 才会重测。
    // 用户改浏览器/系统默认字号（resize → readScale）时，DOM 里 li 的真实高度已变，
    // 但 itemSize 不变 —— 若丢弃实测值的 effect 依赖漏了 scale，measuredSize 会
    // 永久停在旧行高，wrapper 定高与内容高度错位（行重叠/裁切）。
    let rootFontSize = 16;
    let measuredRowHeight = 40;
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      const style = realGetComputedStyle(el);
      if (el === document.documentElement) {
        return new Proxy(style, {
          get(target, prop) {
            if (prop === 'fontSize') return `${rootFontSize}px`;
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
      return style;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          height: measuredRowHeight,
          width: 300,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }) as DOMRect
    );

    const count = 100;
    const renderRow = vi.fn((tab: TabRecord) => <div>row-{tab.id}</div>);
    const view = render(
      <VirtualRowList tabs={tabsOf(count)} itemSize={32} maxHeight={400} renderRow={renderRow} />
    );
    const spacer = () => view.container.querySelector<HTMLElement>('.virtual-row-scroll > div');

    // 首行实测 40px（与估算 32×1 不同）→ measuredSize=40 → 占位高度 = count×40
    await waitFor(() => expect(spacer()?.style.height).toBe(`${count * 40}px`));

    // 用户把默认字号翻倍：rootFontSize 32 → scale=2，DOM 行高随之变为 80px
    rootFontSize = 32;
    measuredRowHeight = 80;
    fireEvent.resize(window);

    // 修复后：scale 变化触发 setMeasuredSize(null) → 重测得到新行高 80 → 占位高度 = count×80。
    // 修复前（依赖仅 [itemSize]）：measuredSize 恒为旧的 40 → 占位高度恒为 count×40。
    await waitFor(() => expect(spacer()?.style.height).toBe(`${count * 80}px`));
  });
});
