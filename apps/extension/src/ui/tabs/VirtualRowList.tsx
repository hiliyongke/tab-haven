import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TabRecord } from '@/core/tab-types';
import { useScrollFade } from '@/ui/common/useScrollFade';

/** 视口外缓冲行数，滚动时避免白屏。 */
const OVERSCAN = 6;

/**
 * 主动定位（⌘J / 定位按钮）请求虚拟列表滚到目标标签：虚拟化后目标行可能未挂载，
 * DOM 查询无从触发，故经此事件按 index 滚动、行挂载后再查 DOM。
 */
export const LOCATE_SCROLL_EVENT = 'tabs:locate-scroll';

/**
 * 定高虚拟列表：只渲染可视区 + 缓冲行，避免长分组挂载上千 DOM 节点。
 * itemSize 为首行实测前的估算值；实测校准消除估算公式与 CSS padding 的隐式耦合。
 * 仅用于无需拖拽重排的场景，重排由调用方回退到全量 SortableContext。
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
  /** 当前激活标签 id；虚拟化下由列表层负责滚入可视区。 */
  activeTabId?: number;
  /** 激活标签自动滚入可视区（与 TabRow 同名开关）。 */
  autoScrollActive?: boolean;
  /** 搜索导航选中的标签 id；命中行可能未挂载，须由列表层按 index 滚入可视区。 */
  searchActiveTabId?: number;
  renderRow: (tab: TabRecord) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 底部渐隐：三层滚动链最内层，截断处需要「还有更多」的可见信号。
  useScrollFade(scrollRef);
  /** 当前渲染窗口首行的外层定高 wrapper（行高实测的挂载点）。 */
  const firstRowRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(maxHeight);
  /** 实测行高（首行自然高度）；null = 尚未测得，先用估算值。 */
  const [measuredSize, setMeasuredSize] = useState<number | null>(null);
  /**
   * 根字号缩放系数（基准 16px），仅作用于 itemSize：它是设计基准 px，放大后行高同步变高，
   * 定高写死会裁内容（WCAG 1.4.4）。实测值本身含缩放不再乘；
   * maxHeight 是真实视口派生 px，再乘等于二次放大。
   */
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const readScale = () => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      setScale(Number.isFinite(root) && root > 0 ? root / 16 : 1);
    };
    readScale();
    window.addEventListener('resize', readScale);
    return () => window.removeEventListener('resize', readScale);
  }, []);

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

  /** 实际生效行高：实测值优先（已含缩放），未测得时退回按字号缩放的估算值。 */
  const effectiveItemSize = measuredSize ?? itemSize * scale;

  // 估算值或缩放变化意味着行高结构已变，丢弃旧实测值重新校准；否则 wrapper 定高与
  // 真实行高不符（行重叠/裁切）。scale 必须在依赖里：漏掉时字号变化后永久沿用旧行高。
  useEffect(() => {
    setMeasuredSize(null);
  }, [itemSize, scale]);

  // 行高实测校准：窗口移动或估算变化后重测 li 自然高度；与生效值一致时不 setState（防反馈循环）。
  const total = tabs.length;
  const totalHeight = total * effectiveItemSize;
  /**
   * scrollTop 上界钳制：tabs 收缩后内容无可滚动余量，浏览器不派发 scroll（越界自愈是
   * UA 行为非契约），scrollTop 恒为旧值。故派生已钳位的 scrolledTop，窗口两端点都用它算，
   * 否则只剩末行挂载。
   */
  const maxScrollTop = Math.max(0, totalHeight - viewport);
  const scrolledTop = Math.min(scrollTop, maxScrollTop);
  const start = Math.min(
    Math.max(0, Math.floor(scrolledTop / effectiveItemSize) - OVERSCAN),
    Math.max(0, total - 1)
  );
  useEffect(() => {
    // 已校准就不再测：start 每行变化都触发会强制同步布局；统一行高一次校准足够，
    // 结构变化由上面的 effect 置回 null 触发重测。
    if (measuredSize !== null) return;
    const inner = firstRowRef.current?.firstElementChild;
    if (!(inner instanceof HTMLElement)) return;
    const height = Math.round(inner.getBoundingClientRect().height);
    if (height > 0 && Math.abs(height - effectiveItemSize) >= 1) setMeasuredSize(height);
  }, [start, effectiveItemSize, measuredSize]);

  // maxHeight 已是真实 px，不再乘 scale。
  const containerHeight = Math.min(totalHeight, maxHeight);
  const end = Math.min(total, Math.ceil((scrolledTop + viewport) / effectiveItemSize) + OVERSCAN);
  const visible = tabs.slice(start, end);

  // rAF 节流：每帧最多一次 setState；必须记录最新值在帧里提交，否则停止滚动时最后一帧
  // scrollTop 丢失，窗口停在旧位置。
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

  // ⌘J 定位：直接写 scrollTop 瞬时滚动，并同步写状态让行在下一次渲染即挂载，不等 rAF。
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

  // 搜索导航选中行滚入可视区：命中行可能未挂载，按 index 滚动容器；逐行移动用瞬时滚动，
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

  // 激活标签自动滚入可视区：目标行可能未挂载，按 index 滚动容器（等价 block:'nearest'）。
  // scrollTo 优先（支持平滑），无该 API 的环境（jsdom）退回直接赋值。
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
      /* scroll-fade：三层滚动链最内层，被 maxHeight 截断需底部边界提示 */
      className="virtual-row-scroll scroll-fade"
      onScroll={handleScroll}
      style={{ height: containerHeight, overflowY: totalHeight > maxHeight ? 'auto' : 'hidden' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/*
          role="list"：虚拟化分支外层无 <ul>，TabRow 的 <li> 会成孤儿，读屏丢失列表语义；
          行 wrapper 标 presentation 让 <li> 挂回 list 上下文。
          aria-setsize 声明全集 N 项：虚拟化只挂载窗口内行，否则读屏按 DOM 数得到随滚动变化的数字。
        */}
        <div
          role="list"
          aria-setsize={total}
          style={{ transform: `translateY(${start * effectiveItemSize}px)` }}
        >
          {visible.map((tab, index) => (
            <div
              key={tab.id}
              ref={index === 0 ? firstRowRef : undefined}
              role="presentation"
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
