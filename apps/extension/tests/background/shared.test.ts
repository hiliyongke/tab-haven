import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { PENDING_ACTIONS_KEY, PENDING_ACTIONS_LIMIT } from '@/platform/messages';
import { settingsRepository } from '@/platform/storage/repositories';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import {
  buildWhitelistMatcher,
  cachedSettings,
  hostnameOf,
  notifyUser,
  queueAction,
  syncCachedSettings
} from '@/platform/background/shared';

/**
 * SW 侧共享上下文（被全部 background 子模块复用）。
 *
 * 这里的每个函数都是「静默失败会变成用户可见故障」的类型：
 *  - `queueAction` 丢条目 → 快捷键/地址栏动作不执行（表现为「按了没反应」）；
 *  - `buildWhitelistMatcher` 误判 → 白名单站点被误休眠（用户数据被动冻结）。
 *
 * 因此断言重点是**边界与降级留痕**，而不只是 happy path。
 */

function lastDiagnostic(): string | undefined {
  return readDiagnostics().at(-1)?.message;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('hostnameOf', () => {
  it('解析合法 URL 的 hostname', () => {
    expect(hostnameOf('https://mail.qq.com/inbox')).toBe('mail.qq.com');
    expect(hostnameOf('http://localhost:3000/x')).toBe('localhost');
  });

  it('空/未定义返回 undefined（不是空串：空串会被当成名为空的合法站点）', () => {
    expect(hostnameOf(undefined)).toBeUndefined();
    expect(hostnameOf('')).toBeUndefined();
  });

  it('非法 URL 返回 undefined 并留痕（不抛错给调用方）', () => {
    expect(hostnameOf('not a url')).toBeUndefined();
    expect(lastDiagnostic()).toBeDefined();
  });
});

describe('buildWhitelistMatcher', () => {
  const matches = (hostname: string, whitelist: string[]) =>
    buildWhitelistMatcher(whitelist)(hostname);

  it('精确 hostname 命中', () => {
    expect(matches('qq.com', ['qq.com'])).toBe(true);
  });

  it('子域命中父域（qq.com 覆盖 mail.qq.com）', () => {
    expect(matches('mail.qq.com', ['qq.com'])).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(matches('MAIL.QQ.COM', ['Qq.CoM'])).toBe(true);
  });

  it('容忍白名单项写成 URL / 带路径 / 带 www（用户手输形态）', () => {
    expect(matches('qq.com', ['https://qq.com/'])).toBe(true);
    expect(matches('qq.com', ['https://www.qq.com/mail'])).toBe(true);
    expect(matches('qq.com', ['  qq.com  '])).toBe(true);
  });

  it('不做后缀误匹配：notqq.com 不应被 qq.com 命中', () => {
    expect(matches('notqq.com', ['qq.com'])).toBe(false);
    expect(matches('qq.com.evil.com', ['qq.com'])).toBe(false);
  });

  it('空白项被忽略，不匹配一切', () => {
    expect(matches('anything.com', ['', '   '])).toBe(false);
  });

  it('空白名单恒不命中', () => {
    expect(matches('a.com', [])).toBe(false);
  });
});

describe('syncCachedSettings', () => {
  it('把存储中的设置读进 SW 缓存', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, badgeMode: 'off' });
    await syncCachedSettings();
    expect(cachedSettings.badgeMode).toBe('off');
  });

  it('读取失败时保持上一次值并留痕（后续 watch 会纠正）', async () => {
    await syncCachedSettings();
    const before = cachedSettings.badgeMode;
    vi.spyOn(settingsRepository, 'read').mockRejectedValue(new Error('storage down'));

    await syncCachedSettings();

    expect(cachedSettings.badgeMode).toBe(before);
    expect(lastDiagnostic()).toContain('设置缓存读取失败');
  });
});

describe('notifyUser', () => {
  it('notifications 不可用时静默返回（不抛错）', () => {
    (fakeBrowser as unknown as { notifications?: unknown }).notifications = undefined;
    expect(() => notifyUser('Tabs', 'hi')).not.toThrow();
  });

  it('可用时创建 basic 通知', async () => {
    const create = vi.fn(async () => 'id');
    (fakeBrowser as unknown as { notifications?: unknown }).notifications = { create };

    notifyUser('Tabs', '已休眠');

    expect(create).toHaveBeenCalledWith(
      'tabs-action',
      expect.objectContaining({ type: 'basic', title: 'Tabs', message: '已休眠', priority: 1 })
    );
  });

  it('不同用途使用不同通知 id（固定 id 会让连续通知互相顶掉）', async () => {
    // 显式签名：裸 vi.fn(async () => 'id') 的 mock.calls 元素类型为 `[]`，取 call[0] 会报错。
    const create = vi.fn<(id?: string, options?: unknown) => Promise<string>>(async () => 'id');
    (fakeBrowser as unknown as { notifications?: unknown }).notifications = { create };

    notifyUser('Tabs', '已休眠 3 个标签（可在侧边栏一键唤醒）', 'auto-discard');
    notifyUser('Tabs', '保存失败，请重试');

    const ids = create.mock.calls.map((call) => call[0] as string);
    expect(ids[0]).not.toBe(ids[1]);
    // Chrome 对同名 id 是替换而非排队：自动休眠那条带着唯一的撤销入口，
    // 被后一条顶掉即「入口消失」。
    expect(ids).toContain('tabs-auto-discard');
    expect(ids).toContain('tabs-action');
  });
});

describe('queueAction 挂起队列', () => {
  it('动作带 at 时间戳写入 session，并即时广播', async () => {
    const send = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    await queueAction({ type: 'focus-search' });

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    const list = rec[PENDING_ACTIONS_KEY] as { type: string; at: number }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.type).toBe('focus-search');
    expect(typeof list[0]!.at).toBe('number');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('并发入队被串行化，不互相覆盖', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    await Promise.all([
      queueAction({ type: 'focus-search' }),
      queueAction({ type: 'locate-active' }),
      queueAction({ type: 'search-domain', query: 'a.com' })
    ]);

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    expect(rec[PENDING_ACTIONS_KEY]).toHaveLength(3);
  });

  it('超过上限时丢弃最旧条目（会话存储不无界增长）', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    for (let i = 0; i < PENDING_ACTIONS_LIMIT + 3; i += 1) {
      await queueAction({ type: 'search-domain', query: `q-${i}` });
    }

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    const list = rec[PENDING_ACTIONS_KEY] as { query: string }[];
    expect(list).toHaveLength(PENDING_ACTIONS_LIMIT);
    // 保留的应是最后 N 条
    expect(list.at(-1)!.query).toBe(`q-${PENDING_ACTIONS_LIMIT + 2}`);
  });

  it('session 中的垃圾数据被 schema 拒绝并重建队列（不把垃圾当合法队列）', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
    await fakeBrowser.storage.session.set({ [PENDING_ACTIONS_KEY]: [{ junk: true }, 'x'] });

    await queueAction({ type: 'focus-search' });

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    const list = rec[PENDING_ACTIONS_KEY] as unknown[];
    expect(list).toHaveLength(1);
  });

  it('session 写入失败时仍广播（仅挂起副本丢失，即时通道不受影响）', async () => {
    const send = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
    const session = fakeBrowser.storage.session as unknown as { set: unknown };
    const original = session.set;
    session.set = () => Promise.reject(new Error('quota'));

    await expect(queueAction({ type: 'focus-search' })).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    expect(lastDiagnostic()).toContain('挂起动作入队失败');
    session.set = original;
  });
});
