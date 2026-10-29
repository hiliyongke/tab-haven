/**
 * 跨页面互斥锁（Web Locks API）。
 * sidepanel / options / background 是各自独立的 JS 上下文，模块级 promise 链只能串行化本页异步操作；
 * 两页并发读写同一 key 时 read-modify-write 仍会交错互覆。Web Locks 是 MV3 各上下文（含 SW）都可用的互斥原语。
 * 环境不支持（jsdom / 旧引擎）时退化为直接执行并只留痕一次——此时页内互斥仍生效，语义不弱于引入本锁前。
 */
// 从日志内核（叶子模块）取留痕能力：从 @/platform/diagnostics 引入会成环（诊断落盘反过来要用本锁）。
import { logDegraded } from '@/platform/log';

/** 降级只告警一次：调用点密集，逐次留痕会刷满诊断缓冲。 */
let degradeWarned = false;

export async function withCrossPageLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') {
    // 降级必须可见：此时跨页互斥实际失效，不留痕则「并发页互覆数据」在诊断里毫无痕迹。
    if (!degradeWarned) {
      degradeWarned = true;
      logDegraded('cross-page-lock', 'Web Locks 不可用，跨页面互斥已降级为页内串行');
    }
    return fn();
  }
  return locks.request(name, fn) as Promise<T>;
}

// ↓ 全仓锁名的唯一声明处。这些分区有多个独立写入方（面板 + background / 多个窗口），
// 锁外 RMW 交错时后写覆盖先写，新增的条目会被静默抹掉。
export const FOLDERS_RMW_LOCK = 'tabs.folders-rmw';
export const PINS_RMW_LOCK = 'tabs.pins-rmw';
export const AUTO_GROUPS_RMW_LOCK = 'tabs.auto-groups-rmw';
/** settings：两个 dataStore 整对象写，须「锁内重读 → 合并 → 写」，否则互丢字段级更新。 */
export const SETTINGS_RMW_LOCK = 'tabs.settings-rmw';
/** collapse：多入口各自一份内存的整表写，锁外写会互相抹掉折叠状态。 */
export const COLLAPSE_RMW_LOCK = 'tabs.collapse-rmw';
/** session：itemTabBindings 整表 RMW，面板与弹窗各持一份内存。 */
export const SESSION_RMW_LOCK = 'tabs.session-rmw';
/** 撤销库写盘：撤销栈整表写，两窗口并发入栈/出栈会互相覆盖。 */
export const UNDO_PERSIST_LOCK = 'tabs.undo-persist';
/** 撤销执行互斥：两窗口可同时撤销同一批次（同批标签恢复两次），执行体经本锁串行化。 */
export const UNDO_EXEC_LOCK = 'tabs.undo-exec';
/** 自动休眠台账：SW 闹钟写批次 / SW 扫描淘汰 / 面板「全部唤醒」三方整表 RMW。 */
export const AUTO_DISCARD_RMW_LOCK = 'tabs.auto-discard-rmw';
/** 快照库：面板归档与 background 关窗自动保存并发时后写覆盖先写。 */
export const SNAPSHOTS_RMW_LOCK = 'tabs.snapshots-rmw';
/** 诊断环形缓冲：所有 platform 模块的降级留痕，锁外交替会在截断边界互相截断。 */
export const DIAG_RMW_LOCK = 'tabs.diagnostics-rmw';
/**
 * 坏数据隔离区：所有持久化键的读取降级都写它。与分区锁是不同锁名（隔离发生在分区锁内），
 * 两者不存在反向嵌套，无死锁面。
 */
export const QUARANTINE_RMW_LOCK = 'tabs.quarantine-rmw';
