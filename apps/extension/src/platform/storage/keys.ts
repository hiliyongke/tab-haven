/**
 * 存储键与闹钟名的唯一声明处（全仓）。`check:privacy` 的「存储键 ↔ PRIVACY.md」比对只扫 `src/platform/**`。
 * 刻意不收两类：registry.ts 随 schema 内联的仓库键（拆开反而要跨文件确认）；
 * 主题镜像键 `tabs:theme` / `tabs:theme-hue`（theme-init.ts 须在渲染前同步执行、不能 import 模块，
 * 故在 ThemeApplier.ts 保留字面量，一致性由 tests 守卫）。
 */

/** 关窗快照的窗口标签缓存（chrome.storage.session，SW 回收后仍能取到）。 */
export const WINDOW_TABS_KEY = 'tabs.window-tabs.v1';

/** 「下一次关窗跳过自动保存」标记（内存 + session 镜像双写，带 TTL）。 */
export const SKIP_AUTO_SAVE_KEY = 'tabs.skip-auto-save-once';

/** 会话级数据（固定条目与真实标签的会话绑定）。 */
export const SESSION_KEY = 'tabs.session';

/** 诊断环形缓冲（降级留痕，供「导出诊断」读取）。 */
export const DIAGNOSTICS_KEY = 'tabs.diagnostics.v1';

/** 待面板执行的动作队列（面板未开时挂起在 session）。 */
export const PENDING_ACTIONS_KEY = 'tabs.pending-actions';

/** 复用豁免额度台账（同网址重复创建的临时放行记账）。 */
export const ALLOWANCE_KEY = 'tabs.allowance.v1';

/** 坏数据隔离区（读盘校验失败时的原始值留档）。 */
export const QUARANTINE_KEY = 'tabs.quarantine';

/** 定时自动快照的闹钟名。 */
export const AUTO_SNAPSHOT_ALARM = 'tabs-auto-snapshot';

/** 自动休眠扫描的闹钟名。 */
export const AUTO_DISCARD_ALARM = 'tabs-auto-discard';
