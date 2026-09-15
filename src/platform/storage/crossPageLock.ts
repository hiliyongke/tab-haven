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
 * 降级会留痕（一次）——锁失效而无人知晓比没有锁更危险。
 */
import { logDegraded } from '@/platform/diagnostics';

/** 降级只告警一次：调用点密集（每次导入/每次设置变更），逐次留痕会刷满诊断缓冲。 */
let degradeWarned = false;

export async function withCrossPageLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') {
    // 静默降级曾是隐患：跨页互斥实际失效，而调用方以为自己持锁。
    // 至少让它可见——否则「并发页互覆数据」在诊断里毫无痕迹。
    if (!degradeWarned) {
      degradeWarned = true;
      logDegraded('cross-page-lock', 'Web Locks 不可用，跨页面互斥已降级为页内串行');
    }
    return fn();
  }
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
/** collapse 分区：与 settings 同为「多入口各自一份内存」的整表写分区，
 *  面板折叠 / 导入事务都会整表覆盖，锁外写会互相抹掉对方的折叠状态。 */
export const COLLAPSE_RMW_LOCK = 'tabs.collapse-rmw';
/** session 分区：itemTabBindings 是整表 read-modify-write，面板与弹窗各持一份内存，
 *  锁外 RMW 会让两页的绑定互相覆盖（标签在固定区与临时区之间跳变）。 */
export const SESSION_RMW_LOCK = 'tabs.session-rmw';
/** 撤销库写盘：撤销栈同样是整表写，两个侧边栏窗口并发入栈/出栈时
 *  整表写本页内存栈会互相覆盖（已撤销批次复活 / 新批次从磁盘消失）。 */
export const UNDO_PERSIST_LOCK = 'tabs.undo-persist';
