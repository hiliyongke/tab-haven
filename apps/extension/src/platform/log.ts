/**
 * 诊断日志内核（叶子模块）。
 *
 * 存在理由：`crossPageLock` 需要在「Web Locks 不可用」时留痕，而
 * `platform/diagnostics` 的落盘又要用 `withCrossPageLock` —— 两者互相 import
 * 构成真环（ESM 下只靠函数提升侥幸工作，一旦求值顺序变化即 TDZ 崩溃）。
 * 本模块只负责「脱敏 + 内存环形缓冲 + console 输出 + 对外投递」，不依赖
 * storage / crossPageLock / 任何 platform 模块，从而把环断开：
 *
 *   log.ts ← crossPageLock.ts ← diagnostics.ts ← （其余消费方）
 *
 * 落盘、导出、全局兜底等需要浏览器 API 的能力仍留在 `platform/diagnostics`，
 * 它通过 `setDiagnosticSink` 订阅本模块产生的每一条记录。
 *
 * 唯一的例外是 `platform/storage/keys`：它是**零导入的常量模块**（连 browser 都不碰），
 * 引入它不产生任何环，换来的好处是存储键脱敏白名单与键名声明处同源。
 */
import {
  ALLOWANCE_KEY,
  DIAGNOSTICS_KEY,
  PENDING_ACTIONS_KEY,
  QUARANTINE_KEY,
  SESSION_KEY,
  SKIP_AUTO_SAVE_KEY,
  WINDOW_TABS_KEY
} from '@/platform/storage/keys';

/** 环形缓冲容量（内存缓冲与落盘共享缓冲同上限）。 */
export const DIAGNOSTIC_MAX_ENTRIES = 100;
const MAX_ENTRIES = DIAGNOSTIC_MAX_ENTRIES;

/**
 * 受保护的存储键名（**脱敏白名单**）。
 *
 * 诊断里出现最多的不是 URL，而是「数据读取失败（tabs.snapshots.v1）」这类带键名的
 * 消息。键名会被 ② 当成裸域名脱敏成 `<url>.v1` —— 所有键塌成同一形态，诊断导出
 * 因此无法回答最基本的问题：**哪个键坏了**。
 *
 * 白名单化而非泛化匹配的原因：键名是本项目自己定义的有限集合，豁免是安全的；
 * 泛化匹配 `tabs.<任意>` 会连真实域名 `tabs.example.com/…` 一起豁免，那正是本模块
 * 「宁可过度脱敏也不漏一条」要防的事。
 *
 *   - `platform/storage/keys.ts` 的键直接取其导出常量（零重复）；
 *   - `platform/registry.ts` 的分区键与 schema 同处一行、刻意不收进 keys.ts，
 *     此处只为脱敏复述一次；漂移由 `tests/platform/storage-key-token.test.ts` 守卫。
 */
const STORAGE_KEY_TOKENS: readonly string[] = [
  WINDOW_TABS_KEY,
  SKIP_AUTO_SAVE_KEY,
  SESSION_KEY,
  DIAGNOSTICS_KEY,
  PENDING_ACTIONS_KEY,
  ALLOWANCE_KEY,
  QUARANTINE_KEY,
  'tabs.fixed-folders.v1',
  'tabs.persistent-pins.v1',
  'tabs.site-collapse.v1',
  'tabs.settings.v1',
  'tabs.undo-stack.v1',
  'tabs.redo-stack.v1',
  'tabs.auto-groups.v1',
  'tabs.auto-discard-batch.v1',
  'tabs.sync-seeded.v1',
  'tabs.snapshots.v1'
];

export interface DiagnosticEntry {
  at: string;
  /** 降级发生的逻辑域，如 'session' / 'sync-mirror' / 'auto-group'。 */
  scope: string;
  message: string;
  /** 只存 message 不存 stack，避免缓冲体积膨胀。 */
  detail?: string;
}

const buffer: DiagnosticEntry[] = [];

/**
 * 日志脱敏。
 *
 * 只匹配 `http(s)://` 开头的串是不够的 —— 以下三种形式会**原样落盘**：
 *   ① 裸域名 + 路径：`example.com/private/path`
 *   ② 带端口：`localhost:8080/admin`（无点分级，① 的 TLD 规则抓不到）
 *   ③ 含用户信息：`https://user:pass@example.com/`（旧正则只替换 `https://` 之后的
 *      整段，看似命中，但裸写 `user:pass@example.com` 时不带协议头就会漏）
 *
 * 诊断日志的定位是「本地排障」，且Tabs无遥测、日志只在用户主动导出时离开设备；
 * 但导出文件常被用户贴到 issue 里求援 —— 脱漏 URL 等于把浏览记录公开出去。
 * 因此宁可**过度脱敏**（把可疑的主机名一并替换为 <url>），也不漏一条。
 */
const REDACT_PATTERNS: RegExp[] = [
  // ① 带协议头的完整 URL（含 user:pass@ / 端口 / 查询串）
  /[a-z][a-z0-9+.-]*:\/\/[^\s'")\]}]+/gi,
  // ② 裸域名 + 可选端口 + 可选路径：至少一个点分级，避免把普通英文词误判成域名。
  //    TLD 取 2-24 位字母。
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}(?::\d{1,5})?(?:\/[^\s'")\]}]*)?/gi,
  // ③ 无点分级的主机名 + 端口（如 `localhost:8080/admin`）。
  //    ② 要求点分级，抓不到 localhost:8080，故单列。
  /(?<![.\w-])[a-z0-9-]*[a-z][a-z0-9-]*:\d{1,5}(?:\/[^\s'")\]}]*)?/gi,
  // ④ 含 @ 的凭据段（兜底）
  /\b[a-z0-9._%+-]+:[^\s@]+@[^\s'")\]}]+/gi,
  // ⑤ 裸 IPv4（可带端口与路径）：② 要求 TLD 是字母、③ 要求主机名含字母，
  //    两者都抓不到 `10.0.0.5` 与 `192.168.1.1:8080/admin`（内网地址同样是浏览痕迹）。
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/[^\s'")\]}]*)?/g
];

/**
 * ② 会误伤「文件名:行号」（如 `file.ts:42` —— `ts` 被当成 TLD）。
 * 源码/文档扩展名不会是真实域名的 TLD，故在脱敏前先保护这类 token。
 * 代价：一个真实域名若以这些串结尾且后面紧跟 `:数字`，会漏掉 —— 现实中不成立。
 */
const FILE_LINE_TOKEN =
  /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|htm|xml|yml|yaml|svg|png|jpg|jpeg|gif|webp|py|rb|go|rs|java|kt|c|h|cpp|sh|txt|csv|log|map|lock):\d+(?::\d+)?\b/gi;

/**
 * 存储键 token：与 `FILE_LINE_TOKEN` 同机制（脱敏前占位、脱敏后还原）。
 *
 * 先按长度降序排：正则的交替分支按书写顺序取首个匹配，`tabs.session` 会在
 * `tabs.session-rmw` 里先行命中并留下未受保护的尾巴（长短混杂时结果不可预期）。
 */
const STORAGE_KEY_TOKEN = new RegExp(
  `\\b(?:${[...STORAGE_KEY_TOKENS]
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'g'
);

/** 把命中的 token 换成占位符并记进 `sink`，脱敏后按序还原。 */
function protectTokens(text: string, pattern: RegExp, sink: string[]): string {
  return text.replace(pattern, (matched) => {
    sink.push(matched);
    return `\uE000${sink.length - 1}\uE000`;
  });
}

function redactUrls(text: string): string {
  // 先占位保护文件名:行号与存储键名，脱敏后还原 —— 比写一条巨型负向断言更易读也更易验证。
  const protectedTokens: string[] = [];
  let out = protectTokens(text, FILE_LINE_TOKEN, protectedTokens);
  out = protectTokens(out, STORAGE_KEY_TOKEN, protectedTokens);
  for (const pattern of REDACT_PATTERNS) out = out.replace(pattern, '<url>');
  // 还原不到就**原样保留**占位串，而不是替换成空串：诊断日志里若本就含有
  // 私有区字符（U+E000 段）组成的同形串，空串会把那段内容静默吞掉，
  // 排查时看到的是"日志缺了一块"，比看到一个怪字符更难定位。
  return out.replace(/\uE000(\d+)\uE000/g, (m, i) => protectedTokens[Number(i)] ?? m);
}

/** 供行为测试断言脱敏结果。内部函数，不参与产品路径。 */
export const redactUrlsForTest = redactUrls;

/** 提取错误详情：只取 message（不取 stack，避免缓冲膨胀），并做 URL 脱敏。 */
function detailOf(error: unknown): string | undefined {
  const raw =
    error instanceof Error ? error.message : error === undefined ? undefined : String(error);
  return raw === undefined ? undefined : redactUrls(raw);
}

/** 落盘订阅者（由 platform/diagnostics 注册）：收到即并入其待写增量。 */
let sink: ((entry: DiagnosticEntry) => void) | undefined;

/** 注册落盘订阅者。幂等覆盖：诊断模块是唯一订阅方。 */
export function setDiagnosticSink(next: (entry: DiagnosticEntry) => void): void {
  sink = next;
}

function push(entry: DiagnosticEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  sink?.(entry);
}

/**
 * 记录一次降级（静默失败）。
 *
 * 用于替代不可观测的错误处理（`catch {}` / `catch { return null }`）；
 * 例外是「确认无后果」的吞错（如通知、徽标这类纯装饰性写入），那些可以留空 catch。
 * 调用点语义：主流程可以继续，但本次操作未产生预期效果。
 *
 * `quiet`：预期内竞态（如「组在查询与写入之间被解散」）置 true。
 * Chrome 扩展管理页的「错误」面板会记录扩展上下文的 warning 与 error 级
 * console 输出（官方行为），预期内竞态刷在那里只会淹没真实故障——用户看到
 * 的是一屏「报错」，而这些记录本来只该出现在诊断导出里。
 * quiet 仍然进诊断环形缓冲（可导出排查），只是输出降为 debug 级。
 */
export function logDegraded(
  scope: string,
  message: string,
  error?: unknown,
  options?: { quiet?: boolean }
): void {
  push({ at: new Date().toISOString(), scope, message, detail: detailOf(error) });
  // console 输出只在开发期保留：生产构建里 import.meta.env.DEV 被替换为 false，
  // 整段由 DCE 移除，产物中不留 console.warn / console.debug。
  // 诊断记录已在上一行 push() 完成（进内存缓冲 + 投递落盘订阅者），
  // 因此移除 console 输出**不影响**「导出诊断信息」的完整性。
  if (!import.meta.env.DEV) return;
  const line = `[Tabs][${scope}] ${message}`;
  if (options?.quiet) console.debug(line, error ?? '');
  else console.warn(line, error ?? '');
}

/** 记录一次真实失败（操作未达成且无法自动恢复）。 */
export function logFailure(scope: string, message: string, error?: unknown): void {
  // 脱敏值只算一次并**两条出口共用**：落盘前过脱敏而 console 直出原始 error 时，
  // 控制台成了绕过脱敏的通道 —— 用户常把 chrome://extensions 的错误面板内容
  // （或本地控制台输出）直接贴进 issue，那是脱敏唯一想防的泄露面。
  const detail = detailOf(error);
  push({ at: new Date().toISOString(), scope, message, detail });
  // 真实失败保留 error 级输出：chrome://extensions 的「错误」面板会收录扩展
  // 上下文的 error 级 console，这是用户/开发者现场发现故障的最后一条可见路径。
  console.error(`[Tabs][${scope}] ${message}`, detail ?? '');
}

/** 本上下文内存快照（按时间升序）。跨上下文全量请用 readAllDiagnostics。 */
export function readDiagnostics(): DiagnosticEntry[] {
  return [...buffer];
}

/** 清空内存缓冲（「清空诊断」时与共享缓冲一并清掉，避免旧记录复活）。 */
export function clearDiagnosticBuffer(): void {
  buffer.length = 0;
}
