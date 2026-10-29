import { browser } from 'wxt/browser';
import { z } from 'zod';
import { DIAG_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { DIAGNOSTICS_KEY } from '@/platform/storage/keys';
import type { QuarantineEntry } from '@/platform/storage/DataRepository';
import {
  DIAGNOSTIC_MAX_ENTRIES,
  clearDiagnosticBuffer,
  logDegraded,
  logFailure,
  readDiagnostics,
  setDiagnosticSink,
  type DiagnosticEntry
} from '@/platform/log';

/**
 * 诊断记录的**落盘与导出**层。
 * 分工：日志的产生、脱敏与内存环形缓冲在叶子模块 @/platform/log（不依赖任何 platform 模块，故
 * crossPageLock 可安全向它留痕而不成环）；本模块负责需浏览器 API 的部分 —— 跨上下文共享缓冲、
 * 全局异常兜底、导出。
 * 存储模型：内存环形缓冲（本上下文即时可读）+ storage.local 共享环形缓冲（跨上下文可读）。
 * MV3 各上下文模块实例互不相通且 SW 回收即丢，纯内存缓冲会让「导出诊断」永远读不到 background 侧的
 * 故障记录 —— 而那恰是多数 logDegraded 的产生地。落盘经 500ms 去抖与跨页锁；落盘失败仅留在内存队列，
 * 诊断自身失败不再上报（避免自举循环）。仅记录技术上下文，不记录标签标题与 URL 等浏览内容。
 */

export type { DiagnosticEntry };
// 不含 redactUrlsForTest：它是**脱敏规则的测试夹具**，只服务 tests/platform/diagnostics-redact*.test.ts，
// 从 @/platform/log 直接取；挂在诊断层（生产出口）会让测试专用能力看起来是公开契约。
export { logDegraded, logFailure, readDiagnostics };

/** 环形缓冲的落盘去抖：留痕调用点密集，逐条写盘会放大 storage 写放大。 */
const PERSIST_DEBOUNCE_MS = 500;

const StoredEntriesSchema = z.array(
  z.object({
    at: z.string(),
    scope: z.string(),
    message: z.string(),
    detail: z.string().optional()
  })
);

/** 本上下文产生、尚未落盘的增量。 */
let pending: DiagnosticEntry[] = [];
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePersist(): void {
  if (persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void flushDiagnostics();
  }, PERSIST_DEBOUNCE_MS);
}

// 订阅日志内核：每条新记录并入待写增量并触发去抖落盘。
setDiagnosticSink((entry) => {
  pending.push(entry);
  if (pending.length > DIAGNOSTIC_MAX_ENTRIES) {
    pending.splice(0, pending.length - DIAGNOSTIC_MAX_ENTRIES);
  }
  schedulePersist();
});

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
      // 清空竞态：本批次在「清空」之后才拿到锁，epoch 落后于当前值时直接丢弃（清空语义优先）。
      if (epoch !== clearEpoch) return;
      const raw = (await area.get(DIAGNOSTICS_KEY))[DIAGNOSTICS_KEY];
      const existing = StoredEntriesSchema.safeParse(raw);
      const merged = [...(existing.success ? existing.data : []), ...batch];
      await area.set({ [DIAGNOSTICS_KEY]: merged.slice(-DIAGNOSTIC_MAX_ENTRIES) });
    });
  } catch {
    // 落盘失败回填待写队列（有界），下一条日志会触发下一轮 flush。
    pending.unshift(...batch);
    if (pending.length > DIAGNOSTIC_MAX_ENTRIES) {
      pending.splice(0, pending.length - DIAGNOSTIC_MAX_ENTRIES);
    }
  }
}

/** 最小事件目标形状：绕开 window / ServiceWorkerGlobalScope 的类型分歧。 */
interface ErrorEventTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * 安装全局异常兜底，返回卸载函数。
 * ErrorBoundary 只覆盖 React 渲染期异常，事件处理器与异步回调里漏网的 rejection 不会进诊断环形缓冲 ——
 * 对无遥测产品等于这类故障全无线索。这是最后一道兜底，不替代各处的显式 catch。
 * 页面上下文（window）与 SW 上下文（self）都安装，否则 background 的 alarms / omnibox / contextMenus
 * 等异步路径漏网时诊断里连一条线索都没有。资源加载失败的 error 事件不计入（噪声大且无排查价值）。
 */
export function installGlobalErrorHandlers(): () => void {
  if (typeof window !== 'undefined') {
    const onRejection = (event: PromiseRejectionEvent): void => {
      logFailure('global', '未处理的 Promise rejection（未被任何 catch 覆盖）', event.reason);
    };
    const onError = (event: ErrorEvent): void => {
      // 资源加载失败（img / script / link）同样派发 error，此时 event.error 为 null，只记真正的运行时异常。
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

  // SW / Worker 上下文：事件对象不是 ErrorEvent / PromiseRejectionEvent 的页面实现，只取 reason 与 error 字段。
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
    const raw = (await area.get(DIAGNOSTICS_KEY))[DIAGNOSTICS_KEY];
    const parsed = StoredEntriesSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return readDiagnostics();
  }
}

/** 清空全部诊断记录（本上下文内存 + 共享环形缓冲）。 */
export async function clearDiagnostics(): Promise<void> {
  // 先递增代数：在途 flush 落盘前发现代数落后即丢弃批次，否则正等在锁上的 flush 会在 remove 之后写回旧记录。
  clearEpoch += 1;
  clearDiagnosticBuffer();
  pending = [];
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  const area = browser.storage?.local;
  if (!area) return;
  try {
    await area.remove(DIAGNOSTICS_KEY);
  } catch {
    // 尽力而为：导出后清理失败只意味着记录多留一轮，不影响正确性。
  }
}

/**
 * 诊断信息导出为 JSON 文本：只含技术上下文（时间戳/域/描述/错误），不含标签标题与 URL，
 * 保证「导出诊断」这一用户主动行为仍不泄露浏览内容。
 */
export function exportDiagnostics(
  entries: DiagnosticEntry[],
  quarantine: QuarantineEntry[] = []
): string {
  const payload = {
    product: 'Tabs',
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    entries,
    // 坏数据留档：只在用户主动导出时才离开本机，且不写入诊断环形缓冲（会被真正的故障挤出）。
    quarantine
  };
  return JSON.stringify(payload, null, 2);
}
