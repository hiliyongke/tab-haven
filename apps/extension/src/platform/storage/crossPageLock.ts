/**
 * 跨页面互斥锁（Web Locks API）。
 *
 * 扩展的 sidepanel / options / background 是各自独立的 JS 上下文，
 * 模块级 promise 链只能串行化「本页面」的异步操作；两个页面并发读写同一
 * storage key 时，read-modify-write 仍会交错互覆（last-writer-wins）。
 * Web Locks 是 MV3 各上下文（含 SW）都可用的跨上下文互斥原语。
 *
 * 环境不支持（单测 jsdom / 旧引擎）时退化为直接执行：调用方页内互斥
 * （如页内串行链 / store 内的执行中标志）仍然生效，语义不弱于引入本锁之前。
 * 降级会留痕（一次）——锁失效而无人知晓比没有锁更危险。
 */
// 从日志内核（叶子模块）取留痕能力：若从 `@/platform/diagnostics` 引入会形成
// diagnostics ↔ crossPageLock 的循环依赖（诊断落盘反过来要用本锁）。
import { logDegraded } from '@/platform/log';

/** 降级只告警一次：调用点密集（每次导入/每次设置变更），逐次留痕会刷满诊断缓冲。 */
let degradeWarned = false;

export async function withCrossPageLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') {
    // 降级必须可见：此时跨页互斥实际失效，而调用方以为自己持锁。
    // 不留痕的话「并发页互覆数据」在诊断里毫无痕迹。
    if (!degradeWarned) {
      degradeWarned = true;
      logDegraded('cross-page-lock', 'Web Locks 不可用，跨页面互斥已降级为页内串行');
    }
    return fn();
  }
  return locks.request(name, fn) as Promise<T>;
}

/**
 * folders/pins/autoGroups 及其余分区的 RMW 锁（**全仓锁名的唯一声明处**）。
 *
 * 这些分区有两个独立写入方：面板（coalesced「末值落盘」）与 background
 * （右键菜单加条目/固定页面、自动分组记账）。锁外 read-modify-write 交错时
 * 后写覆盖先写，右键新增的条目/组记录会被静默抹掉。双方必须共用同一把锁。
 */
export const FOLDERS_RMW_LOCK = 'tabs.folders-rmw';
export const PINS_RMW_LOCK = 'tabs.pins-rmw';
export const AUTO_GROUPS_RMW_LOCK = 'tabs.auto-groups-rmw';
/** settings 分区：options / sidepanel 各有独立 dataStore，
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
/**
 * 撤销执行互斥锁：两个侧边栏窗口（各自独立上下文）可同时撤销同一批次，
 * 同一批标签被恢复两次。执行体经本锁串行化，配合锁内按磁盘栈复核批次仍存在
 * （他页可能已撤销），双重恢复由此根治。
 *
 * 锁名与其它锁同处一层：**存储键只在 platform 层声明**（唯一触碰 chrome.* 的层），
 * `check:privacy` 的「存储键 ↔ PRIVACY.md 第 3 节」比对也只扫 platform，
 * 声明散落到 stores 会让该键游离在文档约束之外。
 */
export const UNDO_EXEC_LOCK = 'tabs.undo-exec';
/**
 * 自动休眠台账：三个写入方（SW 闹钟写入新批次、SW 扫描淘汰失效批次、
 * 面板「全部唤醒」摘除该轮）都是整表 read-modify-write，锁外并发会 last-writer-wins：
 * 刚清除的批次被写回（「全部唤醒」点了没反应）/ 刚写入的批次被覆盖丢失
 * （该轮自动休眠失去撤销出口）。
 */
export const AUTO_DISCARD_RMW_LOCK = 'tabs.auto-discard-rmw';
/**
 * 快照库 read-modify-write：快照列表是整表写，面板归档与 background 关窗自动
 * 保存并发时后写覆盖先写（刚归档的快照凭空消失）。
 */
export const SNAPSHOTS_RMW_LOCK = 'tabs.snapshots-rmw';
/**
 * 诊断环形缓冲：写入方是所有 platform 模块的降级留痕（并发度最高的一处），
 * 锁外交替会让缓冲区在截断边界上互相截断。
 */
export const DIAG_RMW_LOCK = 'tabs.diagnostics-rmw';
/**
 * 坏数据隔离区（`tabs.quarantine`）：写入方是**所有**持久化键的读取降级，
 * 「get → push → 截断 → set」在锁外并发时两个上下文会各自基于旧列表追加并互相
 * 截断对方的条目。隔离区是坏数据的唯一现场，它自己丢数据等于承诺落空。
 *
 * 与分区锁（如 FOLDERS_RMW_LOCK）是**不同**的锁名：隔离发生在分区锁内
 * （逐元素恢复要「先隔离再回写」），两者不存在反向嵌套，故无死锁面。
 */
export const QUARANTINE_RMW_LOCK = 'tabs.quarantine-rmw';
