import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TabRecord } from '@/core/tab-types';

/** 预渲染的视口外缓冲行数，滚动时避免白屏。 */
const OVERSCAN = 6;

/**
 * 零依赖的定高虚拟列表：只渲染可视区 + 上下缓冲的少量行，
 * 用 translateY 把窗口定位到正确偏移。用于 200+ 标签的长分组，
 * 避免一次性挂载上千个 DOM 节点导致侧边栏卡顿。
 *
 * - 列表较短（totalHeight ≤ maxHeight）时退化为普通渲染，行为与未虚拟化一致；
 * - 仅在父级不需要拖拽重排时使用（重排场景由调用方回退到全量 SortableContext）。
 */
export function VirtualRowList({
  tabs,
  itemSize,
  maxHeight,
  renderRow
}: {
  tabs: readonly TabRecord[];
  /** 单行高度（px），必须等于实际行高：偏大产生空隙、偏小内容溢出重叠。 */
  itemSize: number;
  /** 视口最大高度（px）；超过则内部滚动，否则自适应内容高度。 */
  maxHeight: number;
  renderRow: (tab: TabRecord) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(maxHeight);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = tabs.length;
  const totalHeight = total * itemSize;
  const containerHeight = Math.min(totalHeight, maxHeight);
  const start = Math.max(0, Math.floor(scrollTop / itemSize) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / itemSize) + OVERSCAN);
  const visible = tabs.slice(start, end);

  // rAF 节流：滚动事件每帧最多触发一次 setState，避免高频滚动时整树反复重渲染
  const scrollRafRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollRafRef.current), []);
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      setScrollTop(top);
    });
  };

  return (
    <div
      ref={scrollRef}
      className="virtual-row-scroll"
      onScroll={handleScroll}
      style={{ height: containerHeight, overflowY: totalHeight > maxHeight ? 'auto' : 'hidden' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * itemSize}px)` }}>
          {visible.map((tab) => (
            <div key={tab.id} style={{ height: itemSize }}>
              {renderRow(tab)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
