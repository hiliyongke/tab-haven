import { useEffect } from 'react';
import { isModalOpen } from '@/ui/dialog/Dialog';
import { useLatestRef } from '@/ui/hooks/useLatestRef';

/**
 * 面板全局快捷键：`⌘/Ctrl + P` 命令面板、`⌘/Ctrl + J` 定位激活标签、`⌘/Ctrl + K` 搜索、
 * `⌘/Ctrl + Z` 撤销最近一批关闭、`⌘/Ctrl + ⇧ + Z` 重做最近一次撤销。
 *
 * 独立成 hook 的直接收益是**监听器只注册一次**：与 runtime 消息分发写在同一个
 * effect 时，依赖数组里带着 `handlePendingAction / notify / showDiscardUndoToast`
 * —— 其中任一变化都会连带把快捷键监听解绑重绑。
 *
 * 回调经 ref 读取最新值，因此调用方**不需要**用 useCallback 稳定它们。
 */

export interface GlobalHotkeyHandlers {
  /** ⌘P：打开命令面板。 */
  openPalette: () => void;
  /** ⌘J：定位当前激活标签。 */
  locateActive: () => void;
  /** ⌘K：聚焦并全选搜索框。 */
  focusSearch: () => void;
  /** ⌘Z：撤销最近一批关闭（文本编辑场景不拦截，原生文本撤销优先）。 */
  undoLast: () => void;
  /** ⌘⇧Z：重做最近一次撤销（把刚恢复回来的标签再次关闭）。 */
  redoLast: () => void;
}

export function useGlobalHotkeys(handlers: GlobalHotkeyHandlers): void {
  const handlersRef = useLatestRef(handlers);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey && !event.ctrlKey) return;
      // 模态打开时不响应：DialogShell 只拦 Tab/Esc，背景未 inert，
      // ⌘K/⌘P/⌘J 会把焦点移到遮罩后的搜索框、滚动背景列表或叠开命令面板。
      if (isModalOpen()) return;
      switch (event.key.toLowerCase()) {
        case 'p':
          event.preventDefault();
          handlersRef.current.openPalette();
          return;
        case 'j':
          event.preventDefault();
          handlersRef.current.locateActive();
          return;
        case 'k':
          event.preventDefault();
          handlersRef.current.focusSearch();
          return;
        case 'z': {
          // 不抢文本编辑场景：输入框/可编辑区内的 ⌘Z / ⌘⇧Z 分别是原生文本撤销与重做。
          // 这道闸门必须**同时**覆盖撤销与重做两个分支——放在分支内部会让其中一条
          // 抢走输入框的原生语义（重做接上时踩过一次：⌘⇧Z 在搜索框内会误触发）。
          const target = event.target;
          if (target instanceof HTMLElement) {
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
          }
          // ⌘⇧Z 是重做语义：走重做，不判成撤销。
          // 此处直接 return 会让重做没有键盘入口 —— 与 toast 上一次性按钮一起
          // 构成「功能建成但触达不到」的半成品承诺。
          if (event.shiftKey) {
            event.preventDefault();
            handlersRef.current.redoLast();
            return;
          }
          event.preventDefault();
          handlersRef.current.undoLast();
          return;
        }
        default:
          return;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // handlersRef 引用恒定（useLatestRef 内部是 useRef），列入依赖不会重挂监听。
  }, [handlersRef]);
}
