/**
 * 诊断日志内核（叶子模块）。
 * 存在理由：crossPageLock 需在「Web Locks 不可用」时留痕，而 platform/diagnostics 的落盘又要用
 * withCrossPageLock —— 互相 import 构成真环（ESM 下只靠函数提升侥幸工作，求值顺序一变即 TDZ 崩溃）。
 * 本模块只做「脱敏 + 内存环形缓冲 + console 输出 + 对外投递」，不依赖 storage / crossPageLock / 任何
 * platform 模块，从而把环断开：log.ts ← crossPageLock.ts ← diagnostics.ts ← （其余消费方）。
 * 落盘、导出、全局兜底等需要浏览器 API 的能力仍留在 platform/diagnostics，它经 setDiagnosticSink
 * 订阅本模块的每条记录。唯一例外是零导入常量模块 platform/storage/keys：引入不产生环，
 * 换来存储键脱敏白名单与键名声明处同源。
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
 * 诊断里出现最多的不是 URL，而是「数据读取失败（tabs.snapshots.v1）」这类带键名的消息；键名会被 ②
 * 当成裸域名脱敏成 `<url>.v1`，所有键塌成同一形态，导出就无法回答「哪个键坏了」。
 * 白名单化而非泛化匹配：键名是本项目自定的有限集合，豁免安全；泛化匹配 `tabs.<任意>` 会连真实域名
 * `tabs.example.com/…` 一起豁免，那正是「宁可过度脱敏也不漏一条」要防的。
 *   - platform/storage/keys.ts 的键直接取其导出常量（零重复）；
 *   - platform/registry.ts 的分区键与 schema 同行、刻意不收进 keys.ts，此处只为脱敏复述一次，
 *     漂移由 tests/platform/storage-key-token.test.ts 守卫。
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
 * 日志脱敏：只匹配 `http(s)://` 开头的串不够，裸域名 + 路径、带端口、含 user:pass@ 的凭据段都会原样落盘。
 * 诊断日志本地排障、无遥测、只在用户主动导出时离开设备；但导出文件常被贴进 issue —— 脱漏 URL 等于
 * 把浏览记录公开出去。故宁可过度脱敏（可疑主机名一并替换为 <url>），也不漏一条。
 */
const REDACT_PATTERNS: RegExp[] = [
  // ① 带协议头的完整 URL（含 user:pass@ / 端口 / 查询串）
  /[a-z][a-z0-9+.-]*:\/\/[^\s'")\]}；，。！？]+/gi,
  // ② 裸域名 + 可选端口 + 可选路径：至少一个点分级，避免把普通英文词误判成域名。TLD 取 2-24 位字母。
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}(?::\d{1,5})?(?:\/[^\s'")\]}；，。！？]*)?/gi,
  // ③ 裸 IPv4 必须先于单标签路径处理，否则端口后的路径会被单独替换，留下「<url>:<url>」。
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/[^\s'")\]}；，。！？]*)?/g,
  // ④ 单标签主机名 + 路径（如 intranet/private/path）；含歧义时优先保护可能的内网 URL。
  /(?<![.\w-])[a-z0-9-]+(?::\d{1,5})?\/[^\s'")\]}；，。！？]*/gi,
  // ⑤ 无点分级的主机名 + 端口（如 localhost:8080/admin）。
  /(?<![.\w-])[a-z0-9-]*[a-z][a-z0-9-]*:\d{1,5}(?:\/[^\s'")\]}；，。！？]*)?/gi,
  // ⑥ 含 @ 的凭据段（兜底）
  /\b[a-z0-9._%+-]+:[^\s@]+@[^\s'")\]}；，。！？]+/gi
];

/**
 * ② 会误伤「文件名:行号」（如 file.ts:42 —— ts 被当成 TLD），故在脱敏前保护明确的源码 token。
 * md / sh 等真实公共后缀绝不豁免：歧义时优先脱敏，不能让浏览 URL 借文件白名单进入日志。
 */
const FILE_LINE_TOKEN =
  /(?<![\w./:-])(?:\/[\w.-]+|\.{1,2}|[\w.-]+)(?:\/[\w.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|htm|xml|yml|yaml|svg|png|jpg|jpeg|gif|webp|py|rb|go|rs|java|kt|c|h|cpp|txt|csv|log|map|lock):\d+(?::\d+)?\b/gi;
const FILE_PATH_TOKEN =
  /(?<![\w./:-])(?:\/[\w.-]+|\.{1,2}|[\w.-]+)(?:\/[\w.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|htm)(?=$|[\s:),\]}])/gi;

/** 已知代码标识符仅按完整 token 豁免；真实同名域名带路径/端口时仍会脱敏。 */
const CODE_API_TOKEN = /(?<![\w./:-])sidePanel\.open(?![\w./:-])/g;

/**
 * 存储键 token：与 FILE_LINE_TOKEN 同机制（脱敏前占位、脱敏后还原）。
 * 先按长度降序排：正则交替分支按书写顺序取首个匹配，tabs.session 会在 tabs.session-rmw 里先行命中
 * 并留下未受保护的尾巴。
 */
const STORAGE_KEY_TOKEN = new RegExp(
  `\\b(?:${[...STORAGE_KEY_TOKENS]
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'g'
);

/** 把命中的 token 换成占位符并记进 sink，脱敏后按序还原。 */
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
  out = protectTokens(out, FILE_PATH_TOKEN, protectedTokens);
  out = protectTokens(out, STORAGE_KEY_TOKEN, protectedTokens);
  out = protectTokens(out, CODE_API_TOKEN, protectedTokens);
  for (const pattern of REDACT_PATTERNS) out = out.replace(pattern, '<url>');
  // 还原不到就原样保留占位串而非替换为空串：日志本就含 U+E000 段同形串时，空串会把那段内容静默吞掉。
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
 * 记录一次降级（静默失败）：替代不可观测的错误处理（catch {} / catch { return null }）；
 * 例外是「确认无后果」的吞错（通知、徽标这类纯装饰性写入）可留空 catch。
 * `quiet`：预期内竞态（如「组在查询与写入之间被解散」）置 true —— Chrome 扩展管理页的「错误」面板
 * 会收录 warning/error 级 console，预期内竞态刷在那里只会淹没真实故障；quiet 仍进诊断环形缓冲，
 * 只是输出降为 debug 级。
 */
export function logDegraded(
  scope: string,
  message: string,
  error?: unknown,
  options?: { quiet?: boolean }
): void {
  const safeMessage = redactUrls(message);
  const detail = detailOf(error);
  push({ at: new Date().toISOString(), scope, message: safeMessage, detail });
  // console 输出只在开发期保留：生产构建里 import.meta.env.DEV 被替换为 false，整段由 DCE 移除。
  // 诊断记录已在上一行 push() 完成，移除 console 不影响「导出诊断」的完整性。
  if (!import.meta.env.DEV) return;
  const line = `[Tabs][${scope}] ${safeMessage}`;
  if (options?.quiet) console.debug(line, detail ?? '');
  else console.warn(line, detail ?? '');
}

/** 记录一次真实失败（操作未达成且无法自动恢复）。 */
export function logFailure(scope: string, message: string, error?: unknown): void {
  // 脱敏值算一次并两条出口共用：落盘前过脱敏而 console 直出原始 error 会让控制台成为绕过脱敏的通道
  // （用户常把 chrome://extensions 错误面板内容贴进 issue，那是脱敏唯一想防的泄露面）。
  const safeMessage = redactUrls(message);
  const detail = detailOf(error);
  push({ at: new Date().toISOString(), scope, message: safeMessage, detail });
  // 真实失败保留 error 级输出：chrome://extensions 的「错误」面板会收录，这是现场发现故障的最后一条可见路径。
  console.error(`[Tabs][${scope}] ${safeMessage}`, detail ?? '');
}

/** 本上下文内存快照（按时间升序）。跨上下文全量请用 readAllDiagnostics。 */
export function readDiagnostics(): DiagnosticEntry[] {
  return [...buffer];
}

/** 清空内存缓冲（「清空诊断」时与共享缓冲一并清掉，避免旧记录复活）。 */
export function clearDiagnosticBuffer(): void {
  buffer.length = 0;
}
