import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TabRecord } from '@/core/tab-types';

/** 预渲染的视口外缓冲行数，滚动时避免白屏。 */
const OVERSCAN = 6;

/**
 * 用户主动定位（⌘J / 底部定位按钮）时请求虚拟列表滚动到目标标签。
 * 虚拟化后目标行可能在渲染窗口外（DOM 不存在），App 层的 querySelector
 * 永远找不到——必须「先滚动到 index、行挂载后再查 DOM」，故经此事件通知。
 */
export const LOCATE_SCROLL_EVENT = 'tabs:locate-scroll';

/**
 * 零依赖的定高虚拟列表：只渲染可视区 + 上下缓冲的少量行，用于长分组避免挂载上千个 DOM 节点。
 *
 * itemSize 以调用方估算值起步、首行挂载后实测校准（P2-1：估算公式与 CSS
 * padding 隐式耦合，改任一侧即错位——实测兜底消除该耦合，字号/密度调整不再需要同步改公式）。
 *
 * 仅在父级不需要拖拽重排时使用；重排场景由调用方回退到全量 SortableContext。
 */
export function VirtualRowList({
  tabs,
  itemSize,
  maxHeight,
  activeTabId,
  autoScrollActive = true,
  searchActiveTabId,
  renderRow
}: {
  tabs: readonly TabRecord[];
  /** 单行高度估算值（px）；实际生效值以首行实测为准。 */
  itemSize: number;
  /** 视口最大高度（px）；超过则内部滚动，否则自适应内容高度。 */
  maxHeight: number;
  /** 当前激活标签 id（虚拟化下激活行自动滚入可视区，接替 TabRow 内部的 scrollIntoView）。 */
  activeTabId?: number;
  /** 激活标签自动滚入可视区（与 TabRow 同名开关）。 */
  autoScrollActive?: boolean;
  /**
   * 搜索键盘导航选中的标签 id。
   * 搜索过滤后命中行可能仍在渲染窗口之外（DOM 不存在，TabRow 的
   * scrollIntoView 无从触发）——必须在列表层按 index 滚动，键盘流
   * （↑/↓ + Enter）才不会指向看不见的行。
   */
  searchActiveTabId?: number;
  renderRow: (tab: TabRecord) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 当前渲染窗口首行的外层定高 wrapper（行高实测的挂载点）。 */
  const firstRowRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(maxHeight);
  /** 实测行高（首行自然高度）；null = 尚未测得，先用估算值。 */
  const [measuredSize, setMeasuredSize] = useState<number | null>(null);

  // 事件处理器读取「触发那一刻」的最新 tabs，避免 tabs 每次快照更新都解绑/重绑监听。
  const tabsRef = useRef(tabs);
  // 提交后更新而非渲染期赋值：并发渲染下渲染可能不提交，渲染期写 ref 会泄漏中间值。
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 实际生效行高：实测值优先，未测得时退回估算值。 */
  const effectiveItemSize = measuredSize ?? itemSize;

  // 行高实测校准：窗口移动（start 变化）或估算值变化（密度 / URL 副标题开关）后重测。
  // 实测的是 wrapper 内 li 的自然高度（wrapper 只定高不裁剪，li 可溢出）；
  // 与当前生效值一致时不 setState（防「测→改→再测」反馈循环）。
  const total = tabs.length;
  // 上界钳制：tabs 收缩（搜索过滤/批量关标签）时 scrollTop 仍是旧值，
  // start 可能超过 total，slice 返回空数组使整个虚拟列表空白一瞬。
  // 依赖浏览器「内容高度收缩 → scrollTop 越界钳位 → 派发 scroll」的自愈
  // 是 UA 行为而非契约，显式钳到末行保证任何时刻渲染窗口都非空。
  const start = Math.min(
    Math.max(0, Math.floor(scrollTop / effectiveItemSize) - OVERSCAN),
    Math.max(0, total - 1)
  );
  useEffect(() => {
    const inner = firstRowRef.current?.firstElementChild;
    if (!(inner instanceof HTMLElement)) return;
    const height = Math.round(inner.getBoundingClientRect().height);
    if (height > 0 && Math.abs(height - effectiveItemSize) >= 1) setMeasuredSize(height);
  }, [start, effectiveItemSize]);

  const totalHeight = total * effectiveItemSize;
  const containerHeight = Math.min(totalHeight, maxHeight);
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / effectiveItemSize) + OVERSCAN);
  const visible = tabs.slice(start, end);

  // rAF 节流：滚动事件每帧最多触发一次 setState，避免高频滚动时整树反复重渲染。
  // 必须记录「最新值」再在帧里提交：帧内有 pending 时直接丢弃，会让停止滚动时
  // 最后一帧的 scrollTop 丢失，窗口停在旧位置（表现为列表底部一小段滚不出来）。
  const scrollRafRef = useRef(0);
  const pendingTopRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollRafRef.current), []);
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    pendingTopRef.current = event.currentTarget.scrollTop;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      setScrollTop(pendingTopRef.current);
    });
  };

  // ⌘J 定位：把渲染窗口滚到目标 index（直接写 scrollTop = 瞬时滚动，
  // 无 scrollTo API 差异），同时写 scrollTop 状态——不等 scroll 事件走 rAF，
  // 让行在下一次渲染即挂载。
  useEffect(() => {
    const handleLocateScroll = (event: Event) => {
      const tabId = (event as CustomEvent<number>).detail;
      const index = tabsRef.current.findIndex((tab) => tab.id === tabId);
      const el = scrollRef.current;
      if (index === -1 || !el) return;
      el.scrollTop = index * effectiveItemSize;
      // 读回赋值后的实际位置（无布局环境下原样返回，浏览器中超尾会钳位）
      setScrollTop(el.scrollTop);
    };
    window.addEventListener(LOCATE_SCROLL_EVENT, handleLocateScroll);
    return () => window.removeEventListener(LOCATE_SCROLL_EVENT, handleLocateScroll);
  }, [effectiveItemSize]);

  // 搜索键盘导航选中行滚入可视区：命中行可能未挂载（TabRow 的 scrollIntoView
  // 无从触发），按 index 直接滚动容器。键盘逐行移动用瞬时滚动（auto），
  // 平滑动画在快速连按时会拖沓且目标位置持续过期。
  useEffect(() => {
    if (searchActiveTabId === undefined) return;
    const index = tabsRef.current.findIndex((tab) => tab.id === searchActiveTabId);
    const el = scrollRef.current;
    if (index === -1 || !el) return;
    const top = index * effectiveItemSize;
    const bottom = top + effectiveItemSize;
    if (top < el.scrollTop) {
      el.scrollTop = top;
      setScrollTop(top);
    } else if (bottom > el.scrollTop + el.clientHeight) {
      const next = bottom - el.clientHeight;
      el.scrollTop = next;
      setScrollTop(next);
    }
  }, [searchActiveTabId, effectiveItemSize]);

  // 激活标签自动滚入可视区：目标行可能未挂载，TabRow 内部的 scrollIntoView
  // 不可用，需按 index 直接滚动容器（等价 block:'nearest'：只在目标不可见时滚）。
  // scrollTo 优先（支持平滑动画），无该 API 的环境（jsdom）退回直接赋值。
  useEffect(() => {
    if (!autoScrollActive || activeTabId === undefined) return;
    const index = tabsRef.current.findIndex((tab) => tab.id === activeTabId);
    const el = scrollRef.current;
    if (index === -1 || !el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
    const top = index * effectiveItemSize;
    const bottom = top + effectiveItemSize;
    const scrollToTop = (target: number) => {
      if (typeof el.scrollTo === 'function') el.scrollTo({ top: target, behavior });
      else el.scrollTop = target;
    };
    if (top < el.scrollTop) {
      scrollToTop(top);
    } else if (bottom > el.scrollTop + el.clientHeight) {
      scrollToTop(bottom - el.clientHeight);
    }
  }, [activeTabId, autoScrollActive, effectiveItemSize]);

  return (
    <div
      ref={scrollRef}
      className="virtual-row-scroll"
      onScroll={handleScroll}
      style={{ height: containerHeight, overflowY: totalHeight > maxHeight ? 'auto' : 'hidden' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * effectiveItemSize}px)` }}>
          {visible.map((tab, index) => (
            <div
              key={tab.id}
              ref={index === 0 ? firstRowRef : undefined}
              style={{ height: effectiveItemSize }}
            >
              {renderRow(tab)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
