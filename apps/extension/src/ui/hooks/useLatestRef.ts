import { useEffect, useRef } from 'react';

/**
 * 把每次渲染的最新值装进 ref，供事件监听 / 命令回调 / 全局快捷键读取。
 *
 * 提交后更新而非渲染期赋值：并发渲染下渲染可能不提交，渲染期写 ref 会把未提交的中间值泄漏给监听。
 *
 * 收口成一个 hook 是因为这套样板在本项目出现四处，写四份的代价是约定漂移——
 * 任一处漏掉 effect 改回渲染期赋值，就会泄漏未提交值，且只在特定时序复现、极难归因。
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
