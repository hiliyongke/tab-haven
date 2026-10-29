import { useEffect, type RefObject } from 'react';

/**
 * 内滚区的「底部渐隐」边界提示。
 *
 * 侧边栏多层内滚区（固定空间、快照详情、命令面板结果、虚拟列表）被 `max-height` 截断但无可见底部边界，
 * 用户滚到一半会以为到底。滚动到底时加 `.is-scrolled-to-end`，由 `.scroll-fade`（main.css）
 * 撤掉底部渐隐，避免「到底了还提示有更多」。
 *
 * ResizeObserver 在 jsdom 下不存在（测试环境）：纯增强，缺失时退化为「滚动时才更新」，不影响断言。
 *
 * @param active 容器条件渲染时传入开关。effect 默认只在挂载跑一次，若容器此时还没渲染（`ref.current` 为 null），
 *   后续出现时不会补挂 —— 必须靠这个依赖在容器出现后再跑一次。
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, active?: unknown) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // 2px 容差：缩放/小数像素下 scrollTop + clientHeight 常差不到 1px
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      el.classList.toggle('is-scrolled-to-end', atEnd);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // 内容增删改变 scrollHeight，仅靠 scroll 事件覆盖不到「内容变短」。
    // 但只观察容器等于没观察：容器被 max-height 固定、尺寸从不变化，RO 一次都不回调。
    // 真正变化的信号在内容层，故容器与内容层一并观察。
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (ro) {
      ro.observe(el);
      const content = el.firstElementChild;
      if (content) ro.observe(content);
    }
    // 内容层可能被整体替换（搜索过滤 / 新建文件夹后重挂载）：此时上面的引用已失效，靠重新求值兜住这一次。
    const mo =
      typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => update());
    mo?.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [ref, active]);
}
