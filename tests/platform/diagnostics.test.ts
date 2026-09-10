// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDiagnostics,
  exportDiagnostics,
  installGlobalErrorHandlers,
  logDegraded,
  logFailure,
  readDiagnostics,
  readAllDiagnostics
} from '@/platform/diagnostics';

/**
 * 诊断管道（无遥测产品的唯一排查手段）。
 *
 * 除常规记录/环形缓冲外，本文件重点覆盖 `installGlobalErrorHandlers` ——
 * 它补的是 `ErrorBoundary` 覆盖不到的缺口：事件处理器与异步回调中漏网的 rejection。
 * 若这条兜底失效，这类故障将完全没有线索。
 */

describe('logDegraded / logFailure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('记录 scope / message / detail，且 detail 取自 Error.message', () => {
    logDegraded('demo-scope', '降级了', new Error('根因'));
    const entries = readDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.scope).toBe('demo-scope');
    expect(entries[0]?.message).toBe('降级了');
    expect(entries[0]?.detail).toBe('根因');
  });

  it('非 Error 的 detail 被字符串化，缺省时为空', () => {
    logDegraded('s', 'a', 'just a string');
    logDegraded('s', 'b');
    const entries = readDiagnostics();
    expect(entries[0]?.detail).toBe('just a string');
    expect(entries[1]?.detail).toBeUndefined();
  });

  it('readDiagnostics 返回副本，外部改动不影响内部缓冲', () => {
    logDegraded('s', 'm');
    const snapshot = readDiagnostics();
    snapshot.push({ at: 'x', scope: 'y', message: 'z' });
    expect(readDiagnostics()).toHaveLength(1);
  });

  it('环形缓冲上限 100：超出淘汰最旧记录', () => {
    for (let i = 0; i < 105; i += 1) logDegraded('s', `m-${i}`);
    const entries = readDiagnostics();
    expect(entries).toHaveLength(100);
    expect(entries[0]?.message).toBe('m-5');
    expect(entries.at(-1)?.message).toBe('m-104');
  });

  it('clearDiagnostics 清空本上下文缓冲', async () => {
    logDegraded('s', 'm');
    await clearDiagnostics();
    expect(readDiagnostics()).toHaveLength(0);
  });

  it('readAllDiagnostics 能读到跨上下文共享缓冲中的记录', async () => {
    logDegraded('s', 'shared-entry');
    const all = await readAllDiagnostics();
    expect(all.some((entry) => entry.message === 'shared-entry')).toBe(true);
  });

  it('导出内容只含技术上下文（不含标签标题/URL 等浏览内容）', () => {
    logFailure('s', '崩了', new Error('boom'));
    const text = exportDiagnostics(readDiagnostics());
    const parsed = JSON.parse(text) as {
      product: string;
      entries: { scope: string; message: string }[];
    };
    expect(parsed.product).toBe('Tabs');
    expect(parsed.entries[0]).toMatchObject({ scope: 's', message: '崩了' });
    // 守卫隐私承诺：导出体不得出现任何标签浏览内容字段
    expect(Object.keys(parsed.entries[0] ?? {})).toEqual(['at', 'scope', 'message', 'detail']);
  });
});

describe('installGlobalErrorHandlers 全局兜底', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  /**
   * 捕获安装到 window 上的监听器并直接调用。
   *
   * 不通过 `window.dispatchEvent(new Event('error'))` 派发：jsdom 会把未被
   * preventDefault 的合成 error 事件当作**未捕获异常**上报给测试运行器（表现为
   * 「Unhandled Errors」污染结果）。直接调用被注册的监听器既精确又无此副作用。
   * 注意：直接调用绕过了浏览器监听器注册表，因此注销只能由 removeEventListener
   * 收到的函数引用来断言。
   */
  function installAndCapture(): {
    listeners: Map<string, (event: unknown) => void>;
    removeCalls: unknown[][];
    off: () => void;
  } {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const off = installGlobalErrorHandlers();
    const listeners = new Map<string, (event: unknown) => void>();
    for (const call of addSpy.mock.calls) {
      listeners.set(String(call[0]), call[1] as unknown as (event: unknown) => void);
    }
    return { listeners, removeCalls: removeSpy.mock.calls, off };
  }

  it('未处理的 rejection 被记入诊断（ErrorBoundary 覆盖不到的路径）', () => {
    const { listeners, off } = installAndCapture();
    listeners.get('unhandledrejection')?.({ reason: new Error('unhandled') });
    const entries = readDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.scope).toBe('global');
    expect(entries[0]?.detail).toBe('unhandled');
    off();
  });

  it('运行时异常被记录', () => {
    const { listeners, off } = installAndCapture();
    listeners.get('error')?.({ error: new Error('kaboom') });
    expect(readDiagnostics()).toHaveLength(1);
    expect(readDiagnostics()[0]?.detail).toBe('kaboom');
    off();
  });

  it('资源加载失败（error 为 null/undefined）被忽略，避免淹没 100 条环形缓冲', () => {
    const { listeners, off } = installAndCapture();
    listeners.get('error')?.({ error: null });
    listeners.get('error')?.({ error: undefined });
    expect(readDiagnostics()).toHaveLength(0);
    off();
  });

  it('两类事件各注册一个监听器，且卸载传入的是同一函数引用', () => {
    const { listeners, removeCalls, off } = installAndCapture();
    expect([...listeners.keys()].sort()).toEqual(['error', 'unhandledrejection']);
    const rejection = listeners.get('unhandledrejection');
    const onError = listeners.get('error');
    off();
    expect(removeCalls).toHaveLength(2);
    const removed = removeCalls.map((call) => call[1]);
    expect(removed).toContain(rejection);
    expect(removed).toContain(onError);
  });

  it('安装后立即返回可用的卸载函数（无需等待渲染）', () => {
    const off = installGlobalErrorHandlers();
    expect(off).toBeTypeOf('function');
    off();
    expect(readDiagnostics()).toHaveLength(0);
  });
});
