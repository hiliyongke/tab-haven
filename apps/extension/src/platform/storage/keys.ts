/**
 * 存储键与闹钟名的唯一声明处（**全仓**）。
 *
 * 此前这些字面量散落在 8 个模块里各自 `const XXX_KEY = 'tabs...'`：新增一个键要
 * 先想清楚该放哪个文件，而 PRIVACY.md §3 的「存储键 ↔ 文档」双向比对
 * （`scripts/privacy-check.mjs`，只扫 `src/platform/**`）虽然仍能扫到，但**清单
 * 本身没有一处可枚举的入口** —— 想知道「我们到底存了哪些键」只能靠文档反查。
 *
 * 收口后：新增键只在此处加一行，键清单一眼可尽。
 *
 * 刻意**不收**的两类：
 *  - `registry.ts` 里随 schema 内联的仓库键（键与它的 schema / 默认值同处一行，
 *    拆开反而让「这个键装什么数据」要跨文件确认）；
 *  - 主题镜像键 `tabs:theme` / `tabs:theme-hue`（`theme-init.ts` 必须在渲染前
 *    同步执行、不能 import 任何模块，故在 `ThemeApplier.ts` 保留一份字面量，
 *    两侧一致性由 `tests/config/theme-mirror-keys.test.ts` 守卫）。
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
