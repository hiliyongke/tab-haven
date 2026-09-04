import { useCallback, useRef } from 'react';
import { LOCATE_SECTION_EVENT } from '@/ui/tabs/SectionList';
import { LOCATE_SCROLL_EVENT } from '@/ui/tabs/VirtualRowList';
import { LOCATE_TAB_EVENT } from '@/ui/fixed/FixedArea';

/**
 * 「定位激活标签」hook：滚动到当前激活标签所在行并高亮。
 *
 * 从 `App.tsx` 抽出的原因：这是全文件最重的一段过程式逻辑（含递归重试），
 * 却与主组件的渲染编排毫无耦合 —— 它只依赖「目标标签 id」与两个副作用（notify / 清空搜索词）。
 * 抽出后主组件的 JSX 编排与这条独立链路互不干扰，也使其可被单独测试。
 *
 * 递归重试的必要性：虚拟列表下目标行可能不在渲染窗口内（DOM 不存在）。
 * 流程是「先发滚动事件让虚拟列表滚到目标 index → 行挂载后 querySelector 才能命中」，
 * 命中即止，最多重试 12 次（约 600ms），期间有新的定位请求则本次作废（requestId 守卫）。
 */
export function useLocateActive(params: {
  /** 当前激活标签 id；undefined（无标签窗口）时提示后直接返回。 */
  activeTabId: number | undefined;
  /** 轻量提示（如「未找到激活标签」）。 */
  notify: (message: string) => void;
  /** 定位前清空搜索词：否则过滤态下目标行根本不在列表里。 */
  clearQuery: () => void;
  t: (key: string) => string;
}): () => void {
  const { activeTabId, notify, clearQuery, t } = params;
  /** 请求序号：新请求会让旧请求的重试链失效，避免两次定位互相打架。 */
  const locateRequestRef = useRef(0);

  return useCallback(() => {
    if (activeTabId === undefined) {
      notify(t('toast.activeTabNotFound'));
      return;
    }
    const requestId = ++locateRequestRef.current;
    clearQuery();

    const locateTarget = (): boolean => {
      const target = document.querySelector<HTMLElement>(`[data-tabs-tab-id="${activeTabId}"]`);
      if (!target) return false;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      // 高亮动画定义在 .row-item 上：滚动锚点是 li，视觉行是内部 .row-item。
      const row = target.querySelector<HTMLElement>('.row-item') ?? target;
      row.classList.remove('is-located');
      void row.offsetWidth;
      row.classList.add('is-located');
      window.setTimeout(() => row.classList.remove('is-located'), 1200);
      return true;
    };

    /** 三个事件各自通知不同列表区块：分区展开、固定区滚动、虚拟列表滚动。 */
    const dispatchLocateEvents = () => {
      window.dispatchEvent(new CustomEvent<number>(LOCATE_SECTION_EVENT, { detail: activeTabId }));
      window.dispatchEvent(new CustomEvent<number>(LOCATE_TAB_EVENT, { detail: activeTabId }));
      window.dispatchEvent(new CustomEvent<number>(LOCATE_SCROLL_EVENT, { detail: activeTabId }));
    };

    // 首次直查：目标行已在 DOM 时零延迟定位。
    if (locateTarget()) return;
    dispatchLocateEvents();
    let attempts = 0;
    const retryLocate = () => {
      if (requestId !== locateRequestRef.current) return;
      dispatchLocateEvents();
      if (locateTarget()) return;
      attempts += 1;
      if (attempts < 12) window.setTimeout(retryLocate, 50);
    };
    window.setTimeout(retryLocate, 0);
  }, [activeTabId, notify, clearQuery, t]);
}
