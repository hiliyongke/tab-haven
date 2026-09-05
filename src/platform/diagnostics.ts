/**
 * 降级诊断日志：把静默 catch 收口为可观测记录。
 *
 * 产品无服务端日志可查，本地记录是唯一排查手段。
 * 仅记录技术上下文，不记录标签标题与 URL 等浏览内容。
 */

const MAX_ENTRIES = 100;

export interface DiagnosticEntry {
  at: string;
  /** 降级发生的逻辑域，如 'session' / 'sync-mirror' / 'auto-group'。 */
  scope: string;
  message: string;
  /** 只存 message 不存 stack，避免缓冲体积膨胀。 */
  detail?: string;
}

const buffer: DiagnosticEntry[] = [];

function push(entry: DiagnosticEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
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

/** 快照导出（按时间升序，供设置页「导出诊断信息」使用）。 */
export function readDiagnostics(): DiagnosticEntry[] {
  return [...buffer];
}

export function clearDiagnostics(): void {
  buffer.length = 0;
}

/**
 * 诊断信息导出为 JSON 文本。
 *
 * 刻意只含技术上下文（时间戳/域/描述/错误），不含标签标题与 URL——
 * 保证「导出诊断」这一用户主动行为仍然不泄露浏览内容。
 */
export function exportDiagnostics(): string {
  const payload = {
    product: 'Tabs',
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    entries: readDiagnostics()
  };
  return JSON.stringify(payload, null, 2);
}
