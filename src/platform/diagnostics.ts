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

/** 把本上下文待写增量并入共享环形缓冲（跨页锁内 read → append → trim → write）。 */
async function flushDiagnostics(): Promise<void> {
  const batch = pending.splice(0);
  if (batch.length === 0) return;
  const area = browser.storage?.local;
  if (!area) {
    pending.unshift(...batch);
    return;
  }
  try {
    await withCrossPageLock(DIAG_RMW_LOCK, async () => {
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
 */
export function logDegraded(scope: string, message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? error.message : error === undefined ? undefined : String(error);
  push({ at: new Date().toISOString(), scope, message, detail });
  console.warn(`[Tabs][${scope}] ${message}`, error ?? '');
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
