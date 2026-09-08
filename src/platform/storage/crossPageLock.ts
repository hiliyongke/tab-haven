/**
 * 跨页面互斥锁（Web Locks API）。
 *
 * 扩展的 sidepanel / popup / options / background 是各自独立的 JS 上下文，
 * 模块级 promise 链只能串行化「本页面」的异步操作；两个页面并发读写同一
 * storage key 时，read-modify-write 仍会交错互覆（last-writer-wins）。
 * Web Locks 是 MV3 各上下文（含 SW）都可用的跨上下文互斥原语。
 *
 * 环境不支持（单测 jsdom / 旧引擎）时退化为直接执行：调用方页内互斥
 * （如 undoInFlight / 页内串行链）仍然生效，语义不弱于引入本锁之前。
 */
export async function withCrossPageLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request(name, fn) as Promise<T>;
}
