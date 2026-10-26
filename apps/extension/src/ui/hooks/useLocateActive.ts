import { useCallback, useEffect, useRef } from 'react';
import { translate } from '@/i18n';
import { LOCATE_SECTION_EVENT } from '@/ui/tabs/SectionList';
import { LOCATE_SCROLL_EVENT } from '@/ui/tabs/VirtualRowList';
import { LOCATE_TAB_EVENT } from '@/ui/fixed/events';
import { findFolderItemRow, findTabRow, pulseRow } from '@/ui/domContract';

/** 虚拟列表下目标行可能尚未挂载（滚动事件刚发出），重试间隔。 */
const LOCATE_RETRY_INTERVAL_MS = 50;
/**
 * 等待目标行挂载的总时长上限。
 *
 * 用**时间**而不是「次数 × 间隔」表达上限：后者一旦有人只调其中一个数字，
 * 注释里写的「约 600ms」就成了假话，实际等待窗口被悄悄改变。
 */
const LOCATE_MAX_WAIT_MS = 600;

/**
 * 「定位激活标签」hook：滚动到当前激活标签所在行并高亮。
 *
 * 从 `App.tsx` 抽出的原因：这是全文件最重的一段过程式逻辑（含递归重试），
 * 却与主组件的渲染编排毫无耦合 —— 它只依赖「目标标签 id」与两个副作用（notify / 清空搜索词）。
 * 抽出后主组件的 JSX 编排与这条独立链路互不干扰，也使其可被单独测试。
 *
 * 递归重试的必要性：虚拟列表下目标行可能不在渲染窗口内（DOM 不存在）。
 * 流程是「先发滚动事件让虚拟列表滚到目标 index → 行挂载后 querySelector 才能命中」，
 * 命中即止，超过 LOCATE_MAX_WAIT_MS 仍未挂载即放弃并明确告知（不静默失败）；
 * 期间有新的定位请求则本次作废（requestId 守卫）。
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
      notify(translate('当前没有可定位的标签'));
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
      const target = findTabRow(activeTabId) ?? findFolderItemRow(activeTabId);
      if (!target) return false;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      pulseRow(target, timersRef.current);
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
    const deadline = Date.now() + LOCATE_MAX_WAIT_MS;
    const retryLocate = () => {
      if (requestId !== locateRequestRef.current) return;
      dispatchLocateEvents();
      if (locateTarget()) return;
      if (Date.now() >= deadline) {
        // 到点仍未挂载（该行始终不在虚拟列表的渲染窗口内）：必须说出来，
        // 静默放弃会表现为「点了定位什么都没发生」。
        notify(translate('没找到激活标签所在的行，可稍后重试'));
        return;
      }
      schedule(retryLocate, LOCATE_RETRY_INTERVAL_MS);
    };
    schedule(retryLocate, 0);
  }, [activeTabId, notify, clearQuery]);
}
