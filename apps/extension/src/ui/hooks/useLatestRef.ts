import { useEffect, useRef } from 'react';

/**
 * 把每次渲染的最新值装进 ref，供事件监听 / 命令回调 / 全局快捷键读取。
 *
 * 提交后更新而非渲染期赋值：并发渲染下渲染可能不提交，渲染期写 ref 会把
 * 未提交的中间值泄漏给事件监听。
 *
 * 为什么收口成一个 hook（而不是各处手写 `useRef` + `useEffect`）：
 * 这套样板在本项目出现四处，每处自带一段同样的长注释。写四份的代价不是重复
 * 本身，而是**约定会漂移** —— 任一处漏掉 effect、改回渲染期赋值，就会在并发
 * 渲染下把未提交的中间值泄漏给监听，而这类缺陷只在特定时序复现，极难归因。
 * 收口后「最新值 ref」只有一种写法，漏写无从发生。
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
