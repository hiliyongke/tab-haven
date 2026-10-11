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
 */

/** 环形缓冲容量（内存缓冲与落盘共享缓冲同上限）。 */
export const DIAGNOSTIC_MAX_ENTRIES = 100;
const MAX_ENTRIES = DIAGNOSTIC_MAX_ENTRIES;

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
 * 日志脱敏（R17 / S-2）。
 *
 * 原实现只匹配 `http(s)://` 开头的串 —— 于是以下三种形式会**原样落盘**：
 *   ① 裸域名 + 路径：`example.com/private/path`
 *   ② 带端口：`localhost:8080/admin`（无点分级，① 的 TLD 规则抓不到）
 *   ③ 含用户信息：`https://user:pass@example.com/`（旧正则只替换 `https://` 之后的
 *      整段，看似命中，但裸写 `user:pass@example.com` 时不带协议头就会漏）
 *
 * 诊断日志的定位是「本地排障」，且本产品无遥测、日志只在用户主动导出时离开设备；
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
  /\b[a-z0-9._%+-]+:[^\s@]+@[^\s'")\]}]+/gi
];

/**
 * ② 会误伤「文件名:行号」（如 `file.ts:42` —— `ts` 被当成 TLD）。
 * 源码/文档扩展名不会是真实域名的 TLD，故在脱敏前先保护这类 token。
 * 代价：一个真实域名若以这些串结尾且后面紧跟 `:数字`，会漏掉 —— 现实中不成立。
 */
const FILE_LINE_TOKEN =
  /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|htm|xml|yml|yaml|svg|png|jpg|jpeg|gif|webp|py|rb|go|rs|java|kt|c|h|cpp|sh|txt|csv|log|map|lock):\d+(?::\d+)?\b/gi;

function redactUrls(text: string): string {
  // 先占位保护文件名:行号，脱敏后还原 —— 比写一条巨型负向断言更易读也更易验证。
  const protectedTokens: string[] = [];
  let out = text.replace(FILE_LINE_TOKEN, (m) => {
    protectedTokens.push(m);
    return `\uE000${protectedTokens.length - 1}\uE000`;
  });
  for (const pattern of REDACT_PATTERNS) out = out.replace(pattern, '<url>');
  return out.replace(/\uE000(\d+)\uE000/g, (_m, i) => protectedTokens[Number(i)] ?? '');
}

/** 供行为测试断言脱敏结果（R17 / S-2）。内部函数，不参与产品路径。 */
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
 * 用于替代 `catch {}` / `catch { return null }` 这类不可观测的错误处理。
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
  const line = `[Tabs][${scope}] ${message}`;
  if (options?.quiet) console.debug(line, error ?? '');
  else console.warn(line, error ?? '');
}

/** 记录一次真实失败（操作未达成且无法自动恢复）。 */
export function logFailure(scope: string, message: string, error?: unknown): void {
  push({ at: new Date().toISOString(), scope, message, detail: detailOf(error) });
  console.error(`[Tabs][${scope}] ${message}`, error ?? '');
}

/** 本上下文内存快照（按时间升序）。跨上下文全量请用 readAllDiagnostics。 */
export function readDiagnostics(): DiagnosticEntry[] {
  return [...buffer];
}

/** 清空内存缓冲（「清空诊断」时与共享缓冲一并清掉，避免旧记录复活）。 */
export function clearDiagnosticBuffer(): void {
  buffer.length = 0;
}
