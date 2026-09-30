import { browser } from 'wxt/browser';
import { z } from 'zod';
import { withCrossPageLock } from '@/platform/storage/crossPageLock';

/**
 * 降级诊断日志：把静默 catch 收口为可观测记录。
 *
 * 产品无服务端日志可查，本地记录是唯一排查手段。
 * 仅记录技术上下文，不记录标签标题与 URL 等浏览内容。
 *
 * 存储模型：内存环形缓冲（本上下文即时可读）+ storage.local 共享环形缓冲
 * （跨上下文可读）。MV3 各上下文（background SW / sidepanel / options）模块实例
 * 互不相通且 SW 回收即丢，纯内存缓冲会让「导出诊断」永远读不到 background 侧
 * 的故障记录——而那恰是多数 logDegraded 的产生地。落盘经 500ms 去抖与跨页锁，
 * 写放大与并发交错都有界；落盘失败仅保留在内存队列，诊断自身失败不再上报
 * （避免自举循环）。
 */

const MAX_ENTRIES = 100;
/** 共享环形缓冲的存储键与 RMW 锁名。 */
const STORAGE_KEY = 'tabs.diagnostics.v1';
const DIAG_RMW_LOCK = 'tabs.diagnostics-rmw';
const PERSIST_DEBOUNCE_MS = 500;

export interface DiagnosticEntry {
  at: string;
  /** 降级发生的逻辑域，如 'session' / 'sync-mirror' / 'auto-group'。 */
  scope: string;
  message: string;
  /** 只存 message 不存 stack，避免缓冲体积膨胀。 */
  detail?: string;
}

const StoredEntriesSchema = z.array(
  z.object({
    at: z.string(),
    scope: z.string(),
    message: z.string(),
    detail: z.string().optional()
  })
);

const buffer: DiagnosticEntry[] = [];
/** 本上下文产生、尚未落盘的增量。 */
let pending: DiagnosticEntry[] = [];
let persistTimer: ReturnType<typeof setTimeout> | undefined;

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

function push(entry: DiagnosticEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  pending.push(entry);
  if (pending.length > MAX_ENTRIES) pending.splice(0, pending.length - MAX_ENTRIES);
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void flushDiagnostics();
  }, PERSIST_DEBOUNCE_MS);
}

/** 清空代数：clearDiagnostics 每次递增，flush 落盘前据此丢弃已过期批次（清空后旧记录不得复活）。 */
let clearEpoch = 0;

/** 把本上下文待写增量并入共享环形缓冲（跨页锁内 read → append → trim → write）。 */
async function flushDiagnostics(): Promise<void> {
  const batch = pending.splice(0);
  if (batch.length === 0) return;
  const area = browser.storage?.local;
  if (!area) {
    pending.unshift(...batch);
    return;
  }
  const epoch = clearEpoch;
  try {
    await withCrossPageLock(DIAG_RMW_LOCK, async () => {
      // 清空竞态：本批次在「清空」之后才拿到锁，写回会让清空前的旧记录复活。
      // 批次的 clearEpoch 落后于当前值时直接丢弃（清空语义优先）。
      if (epoch !== clearEpoch) return;
      const raw = (await area.get(STORAGE_KEY))[STORAGE_KEY];
      const existing = StoredEntriesSchema.safeParse(raw);
      const merged = [...(existing.success ? existing.data : []), ...batch];
      await area.set({ [STORAGE_KEY]: merged.slice(-MAX_ENTRIES) });
    });
  } catch {
    // 落盘失败回填待写队列（有界），下一条日志会触发下一轮 flush。
    pending.unshift(...batch);
    if (pending.length > MAX_ENTRIES) pending.splice(0, pending.length - MAX_ENTRIES);
  }
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

/**
 * 安装全局异常兜底，返回卸载函数。
 *
 * 为什么需要：`ErrorBoundary` 只覆盖 React **渲染期**异常；事件处理器与异步回调里
 * 漏网的 rejection 不会进入诊断环形缓冲 —— 对一个「无遥测、无服务端日志」的产品，
 * 那等于这类故障完全没有排查线索。这是最后一道兜底，**不替代**各处的显式 catch：
 * 走到这里的都应该是「我们没预料到」的路径。
 *
 * 页面上下文（window）与 SW 上下文（self）都安装：SW 侧此前完全没有兜底，
 * background 的 alarms / omnibox / contextMenus / 关窗缓存等异步路径一旦漏网，
 * 诊断里连一条线索都没有。无全局对象时安全空转。
 */
/** 最小事件目标形状：绕开 window / ServiceWorkerGlobalScope 的类型分歧。 */
interface ErrorEventTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export function installGlobalErrorHandlers(): () => void {
  if (typeof window !== 'undefined') {
    const onRejection = (event: PromiseRejectionEvent): void => {
      logFailure('global', '未处理的 Promise rejection（未被任何 catch 覆盖）', event.reason);
    };
    const onError = (event: ErrorEvent): void => {
      // 资源加载失败（img / script / link）同样会派发 error，此时 event.error 为 null。
      // 这类噪声量级大且无排查价值（favicon 抓取失败也在其中），只记真正的运行时异常。
      if (event.error === null || event.error === undefined) return;
      logFailure('global', '未捕获的运行时异常', event.error);
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }

  // SW / Worker 上下文：事件对象不是 ErrorEvent / PromiseRejectionEvent 的页面实现，
  // 只取 reason 与 error 字段，取不到就退化为事件本身。
  const target = (typeof self === 'undefined' ? undefined : self) as unknown as
    ErrorEventTarget | undefined;
  if (!target) return () => undefined;
  const onSwRejection = (event: Event): void => {
    const reason = (event as { reason?: unknown }).reason;
    logFailure('global', '未处理的 Promise rejection（background SW）', reason ?? event);
  };
  const onSwError = (event: Event): void => {
    const error = (event as { error?: unknown }).error;
    if (error === null || error === undefined) return;
    logFailure('global', '未捕获的运行时异常（background SW）', error);
  };
  target.addEventListener('unhandledrejection', onSwRejection);
  target.addEventListener('error', onSwError);
  return () => {
    target.removeEventListener('unhandledrejection', onSwRejection);
    target.removeEventListener('error', onSwError);
  };
}

/** 跨上下文全量读取：先冲刷本上下文待写增量，再读共享环形缓冲。 */
export async function readAllDiagnostics(): Promise<DiagnosticEntry[]> {
  await flushDiagnostics();
  const area = browser.storage?.local;
  if (!area) return readDiagnostics();
  try {
    const raw = (await area.get(STORAGE_KEY))[STORAGE_KEY];
    const parsed = StoredEntriesSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return readDiagnostics();
  }
}

/** 清空全部诊断记录（本上下文内存 + 共享环形缓冲）。 */
export async function clearDiagnostics(): Promise<void> {
  // 先递增代数：在途 flush 落盘前发现代数落后即丢弃批次，
  // 否则已拿到旧 batch、正等在锁上的 flush 会在 remove 之后写回旧记录。
  clearEpoch += 1;
  buffer.length = 0;
  pending = [];
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  const area = browser.storage?.local;
  if (!area) return;
  try {
    await area.remove(STORAGE_KEY);
  } catch {
    // 尽力而为：导出后清理失败只意味着记录多留一轮，不影响正确性。
  }
}

/**
 * 诊断信息导出为 JSON 文本。
 *
 * 刻意只含技术上下文（时间戳/域/描述/错误），不含标签标题与 URL——
 * 保证「导出诊断」这一用户主动行为仍然不泄露浏览内容。
 */
export function exportDiagnostics(entries: DiagnosticEntry[]): string {
  const payload = {
    product: 'Tabs',
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    entries
  };
  return JSON.stringify(payload, null, 2);
}
