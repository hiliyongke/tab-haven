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

/**
 * folders/pins/autoGroups 分区的 RMW 锁（快照库锁见 snapshots.ts 的 SNAPSHOTS_RMW_LOCK）。
 *
 * 这些分区有两个独立写入方：面板（coalesced「末值落盘」）与 background
 * （右键菜单加条目/固定页面、自动分组记账）。锁外 read-modify-write 交错时
 * 后写覆盖先写，右键新增的条目/组记录会被静默抹掉。双方必须共用同一把锁。
 */
export const FOLDERS_RMW_LOCK = 'tabs.folders-rmw';
export const PINS_RMW_LOCK = 'tabs.pins-rmw';
export const AUTO_GROUPS_RMW_LOCK = 'tabs.auto-groups-rmw';
/** settings 分区：options / sidepanel / popup 各有独立 dataStore，
 *  整对象写必须以「锁内重读 → 合并 → 写」执行，否则并发页互丢字段级更新。 */
export const SETTINGS_RMW_LOCK = 'tabs.settings-rmw';
