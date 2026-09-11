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
  const detail =
    error instanceof Error ? error.message : error === undefined ? undefined : String(error);
  push({ at: new Date().toISOString(), scope, message, detail });
  const line = `[Tabs][${scope}] ${message}`;
  if (options?.quiet) console.debug(line, error ?? '');
  else console.warn(line, error ?? '');
}

/** 记录一次真实失败（操作未达成且无法自动恢复）。 */
export function logFailure(scope: string, message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? error.message : error === undefined ? undefined : String(error);
  push({ at: new Date().toISOString(), scope, message, detail });
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
 * 不在 `/background` 安装：SW 无 `window`，且其全局监听需另一套事件类型；
 * 由调用方按上下文决定是否安装（本函数在无 window 时安全空转）。
 */
export function installGlobalErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => undefined;
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
