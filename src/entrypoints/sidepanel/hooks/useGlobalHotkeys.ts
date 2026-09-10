import { useEffect, useRef } from 'react';

/**
 * 面板全局快捷键：`⌘/Ctrl + P` 命令面板、`⌘/Ctrl + J` 定位激活标签、`⌘/Ctrl + K` 搜索。
 *
 * 从 `App.tsx` 抽出（原先与 runtime 消息监听挤在同一个 useEffect 里）。抽出的直接收益是
 * **监听器只注册一次**：原实现把快捷键与消息分发写在同一个 effect，依赖数组里带着
 * `handlePendingAction / notify / showDiscardUndoToast` —— 其中任一变化都会连带把
 * 快捷键监听解绑重绑。拆开后两者各管各的依赖，语义不变而重挂次数下降。
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
}

export function useGlobalHotkeys(handlers: GlobalHotkeyHandlers): void {
  // 提交后更新而非渲染期赋值：并发渲染下渲染可能不提交，
  // 渲染期写 ref 会把未提交的中间值泄漏给事件监听。
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey && !event.ctrlKey) return;
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
        default:
          return;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
