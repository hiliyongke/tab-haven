import { useCallback, useEffect, useRef } from 'react';
import i18n from '@/i18n';
import { LOCATE_SECTION_EVENT } from '@/ui/tabs/SectionList';
import { LOCATE_SCROLL_EVENT } from '@/ui/tabs/VirtualRowList';
import { LOCATE_TAB_EVENT } from '@/ui/fixed/events';

/**
 * 给指定标签行播放一次定位脉冲（复用 `.is-located` 的既有动画）。
 *
 * 与 useLocateActive 共用同一套 DOM 约定（`data-tabs-tab-id` → 内部 `.row-item`），
 * 因此放在同文件：两处一旦分家，选择器改动就会漏掉另一处。
 * 用途：批量操作后高亮「被保留的项」（如清理重复后让用户看到每个域名留下了哪一个）。
 */
export function pulseTabRows(tabIds: readonly number[]): void {
  for (const tabId of tabIds) {
    const target = document.querySelector<HTMLElement>(`[data-tabs-tab-id="${tabId}"]`);
    const row = target?.querySelector<HTMLElement>('.row-item') ?? target;
    if (!row) continue;
    row.classList.remove('is-located');
    // 强制重排以重播动画（与 useLocateActive 内同款技巧）
    void row.offsetWidth;
    row.classList.add('is-located');
    window.setTimeout(() => row.classList.remove('is-located'), 1200);
  }
}

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
 *
 * 文案走 `i18n.t` 而非 `useTranslation()` 的 `t`：`t` 的引用随语言切换变化，
 * 会让本 hook 的回调在切换语言时重建，进而让依赖它的键盘监听 effect 重新挂载。
 */
export function useLocateActive(params: {
  /** 当前激活标签 id；undefined（无标签窗口）时提示后直接返回。 */
  activeTabId: number | undefined;
  /** 轻量提示（如「未找到激活标签」）。 */
  notify: (message: string) => void;
  /** 定位前清空搜索词：否则过滤态下目标行根本不在列表里。 */
  clearQuery: () => void;
}): () => void {
  const { activeTabId, notify, clearQuery } = params;
  /** 请求序号：新请求会让旧请求的重试链失效，避免两次定位互相打架。 */
  const locateRequestRef = useRef(0);
  /** 在途定时器：卸载时统一清理，避免对已卸载组件继续操作 DOM。 */
  const timersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);

  return useCallback(() => {
    if (activeTabId === undefined) {
      notify(i18n.t('toast.activeTabNotFound'));
      return;
    }
    const requestId = ++locateRequestRef.current;
    clearQuery();

    const schedule = (fn: () => void, delay: number): void => {
      const id = window.setTimeout(() => {
        timersRef.current.delete(id);
        fn();
      }, delay);
      timersRef.current.add(id);
    };

    const locateTarget = (): boolean => {
      // 优先真实标签行（data-tabs-tab-id）；未命中再查固定条目行
      // （data-folder-tab-id）作兜底——绑定标签被排除在临时区之外时，
      // 它在固定区条目的 DOM 表示是唯一可见的定位目标。
      // 两条路径必须分开：共用属性会让 querySelector 因 DOM 顺序
      // （固定区在列表之前）永远先命中条目，列表中的激活行反而滚不到。
      const target =
        document.querySelector<HTMLElement>(`[data-tabs-tab-id="${activeTabId}"]`) ??
        document.querySelector<HTMLElement>(`[data-folder-tab-id="${activeTabId}"]`);
      if (!target) return false;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      // 高亮动画定义在 .row-item 上：滚动锚点是 li，视觉行是内部 .row-item。
      const row = target.querySelector<HTMLElement>('.row-item') ?? target;
      row.classList.remove('is-located');
      void row.offsetWidth;
      row.classList.add('is-located');
      schedule(() => row.classList.remove('is-located'), 1200);
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
      if (attempts < 12) schedule(retryLocate, 50);
    };
    schedule(retryLocate, 0);
  }, [activeTabId, notify, clearQuery]);
}
