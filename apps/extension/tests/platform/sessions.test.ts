// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getRecentlyClosed, restoreRecentClosed } from '@/platform/sessions';
import { readDiagnostics, clearDiagnostics } from '@/platform/diagnostics';

/**
 * chrome.sessions 桥接层：读取「最近关闭」并并入撤销历史面板。
 *
 * 两个易错点在此守住：
 *  - 无 sessionId 的条目必须被过滤（否则面板渲染出无法恢复的死条目）；
 *  - API 缺失/异常必须降级为空列表**且留痕** —— 静默返回空会让「最近关闭」看起来
 *    真的没有内容，而实际可能是 sessions API 不可用。
 */

type SessionsStub = {
  getRecentlyClosed?: (opts: { maxResults: number }) => Promise<unknown[]>;
  restore?: (sessionId: string) => Promise<void>;
};

function stubSessions(stub: SessionsStub | undefined): void {
  (fakeBrowser as unknown as { sessions?: SessionsStub }).sessions = stub;
}

/** 取最近一条诊断记录的 message（用于断言「留痕」）。 */
function lastDiagnosticMessage(): string | undefined {
  return readDiagnostics().at(-1)?.message;
}

/** 静音诊断输出：logDegraded 走 console.warn，是被测行为的预期副作用。 */
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('getRecentlyClosed', () => {
  afterEach(() => {
    stubSessions(undefined);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('API 不可用时返回空列表（不抛错）', async () => {
    stubSessions(undefined);
    await expect(getRecentlyClosed()).resolves.toEqual([]);
  });

  it('标签与窗口条目都被映射，且 isWindow 正确区分', async () => {
    stubSessions({
      getRecentlyClosed: async () => [
        {
          lastModified: 1,
          tab: { sessionId: 'tab-1', title: 'A', url: 'https://a.com/' }
        },
        {
          lastModified: 2,
          window: { sessionId: 'win-1', tabs: [{}, {}, {}] }
        }
      ]
    });
    const entries = await getRecentlyClosed();
    expect(entries).toEqual([
      {
        sessionId: 'tab-1',
        isWindow: false,
        lastModified: 1,
        title: 'A',
        url: 'https://a.com/'
      },
      { sessionId: 'win-1', isWindow: true, lastModified: 2, tabCount: 3 }
    ]);
  });

  it('缺少 sessionId 的条目被过滤（无法恢复的死条目不进面板）', async () => {
    stubSessions({
      getRecentlyClosed: async () => [
        { lastModified: 1, tab: { title: 'no session id', url: 'https://a.com/' } },
        { lastModified: 2, tab: { sessionId: '', title: 'empty', url: 'https://b.com/' } },
        { lastModified: 3, tab: { sessionId: 'ok', title: 'keep', url: 'https://c.com/' } }
      ]
    });
    const entries = await getRecentlyClosed();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sessionId).toBe('ok');
  });

  it('窗口条目缺少 tabs 时 tabCount 为 0（而非 NaN/undefined）', async () => {
    stubSessions({
      getRecentlyClosed: async () => [{ lastModified: 1, window: { sessionId: 'w' } }]
    });
    const entries = await getRecentlyClosed();
    expect(entries[0]?.tabCount).toBe(0);
  });

  it('读取异常时降级为空列表并留痕（可观测，不能静默）', async () => {
    stubSessions({
      getRecentlyClosed: async () => {
        throw new Error('sessions api down');
      }
    });
    await expect(getRecentlyClosed()).resolves.toEqual([]);
    expect(lastDiagnosticMessage()).toContain('读取最近关闭列表失败');
  });
});

describe('restoreRecentClosed', () => {
  afterEach(() => {
    stubSessions(undefined);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('API 不可用时返回 false', async () => {
    stubSessions(undefined);
    await expect(restoreRecentClosed('s')).resolves.toBe(false);
  });

  it('成功恢复返回 true', async () => {
    const restore = vi.fn(async () => undefined);
    stubSessions({ restore });
    await expect(restoreRecentClosed('s-1')).resolves.toBe(true);
    expect(restore).toHaveBeenCalledWith('s-1');
  });

  it('sessionId 失效/失败返回 false 并留痕（「点了恢复没反应」可排查）', async () => {
    stubSessions({
      restore: async () => {
        throw new Error('invalid session id');
      }
    });
    await expect(restoreRecentClosed('gone')).resolves.toBe(false);
    expect(lastDiagnosticMessage()).toContain('恢复最近关闭条目失败');
  });
});
