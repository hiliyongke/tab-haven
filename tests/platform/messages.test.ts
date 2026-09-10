// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  MessageSchema,
  PENDING_ACTIONS_KEY,
  PENDING_ACTIONS_LIMIT,
  sendMessage,
  sendMessageWithAck,
  onRuntimeMessage,
  watchPendingActions,
  type Message,
  type PendingAction
} from '@/platform/messages';

/**
 * 消息协议契约测试。
 *
 * `src/platform/messages.ts` 的模块注释明确写着「新增消息类型只需改这一处，两端
 * switch 未覆盖的分支由 tests/platform/messages.test.ts 的协议契约测试兜住」——
 * 该文件此前**并不存在**（悬空引用）。本文件补齐这份契约，覆盖三件事：
 *
 *  1. `MessageSchema` 是唯一协议入口：登记的类型必须全部可解析、未登记的必须被拒；
 *  2. 收发两端的降级语义：广播吞 rejection、ack 超时不得挂起调用链；
 *  3. `watchPendingActions` 的双通道（初始 get + onChanged）必须按 `at` 自防重，
 *     且执行即清队列（否则历史动作会随下次写入重放）。
 *
 * 注意：捕获到的监听器只能**直接调用**来模拟事件派发 —— 因此不能用「调用 off() 后
 * 再直接调用监听器」来断言注销，那条路径绕过了浏览器的监听器注册表。注销改由
 * `removeListener` 收到同一函数引用来断言。
 */

/** 注册 runtime 消息监听，返回被注册的监听器与注销函数。 */
function registerRuntimeMessage(handler: (message: Message) => void): {
  listener: (raw: unknown, sender?: { id?: string }) => void;
  off: () => void;
} {
  const addSpy = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');
  const off = onRuntimeMessage(handler);
  const listener = addSpy.mock.calls.at(-1)?.[0] as unknown as (
    raw: unknown,
    sender?: { id?: string }
  ) => void;
  return { listener, off };
}

/** 注册挂起队列 watcher，返回 onChanged 监听器与注销函数。 */
function registerPendingWatcher(handler: (action: PendingAction) => void): {
  listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;
  off: () => void;
} {
  const addSpy = vi.spyOn(fakeBrowser.storage.onChanged, 'addListener');
  const off = watchPendingActions(handler);
  const listener = addSpy.mock.calls.at(-1)?.[0] as unknown as (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string
  ) => void;
  return { listener, off };
}

describe('MessageSchema 协议契约', () => {
  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('登记的全部消息类型都能解析', () => {
    const samples: Message[] = [
      { type: 'allow-duplicate-once', windowId: 1, url: 'https://example.com/' },
      { type: 'duplicate-reused' },
      { type: 'focus-search' },
      { type: 'focus-search', at: 123 },
      { type: 'search-domain', query: 'example.com' },
      { type: 'auto-discarded', tabIds: [1, 2], count: 2, at: 1 },
      { type: 'locate-active' },
      { type: 'skip-auto-save-once', windowId: 7 },
      { type: 'settings-synced' }
    ];
    for (const sample of samples) {
      expect(MessageSchema.safeParse(sample).success, JSON.stringify(sample)).toBe(true);
    }
  });

  it('未登记的类型被拒绝（漏改协议只表现为消息被静默丢弃，必须在测试里拦住）', () => {
    expect(MessageSchema.safeParse({ type: 'not-registered' }).success).toBe(false);
    expect(MessageSchema.safeParse(undefined).success).toBe(false);
    expect(MessageSchema.safeParse('focus-search').success).toBe(false);
    // 缺必填字段同样拒绝
    expect(MessageSchema.safeParse({ type: 'search-domain' }).success).toBe(false);
    expect(MessageSchema.safeParse({ type: 'skip-auto-save-once' }).success).toBe(false);
  });

  it('url / query 有长度上限（超长串是内存与存储放大面）', () => {
    expect(
      MessageSchema.safeParse({
        type: 'allow-duplicate-once',
        windowId: 1,
        url: 'a'.repeat(8192)
      }).success
    ).toBe(true);
    expect(
      MessageSchema.safeParse({ type: 'allow-duplicate-once', windowId: 1, url: 'a'.repeat(8193) })
        .success
    ).toBe(false);
    expect(MessageSchema.safeParse({ type: 'search-domain', query: 'a'.repeat(513) }).success).toBe(
      false
    );
  });

  it('windowId 必须是整数（小数会让豁免账本键失真）', () => {
    expect(MessageSchema.safeParse({ type: 'skip-auto-save-once', windowId: 1.5 }).success).toBe(
      false
    );
  });
});

describe('sendMessage / sendMessageWithAck 降级语义', () => {
  afterEach(() => {
    fakeBrowser.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('无人接收时广播不抛错（面板未开是正常场景，不是故障）', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
      Promise.reject(new Error('Receiving end does not exist'))) as never);
    expect(() => sendMessage({ type: 'duplicate-reused' })).not.toThrow();
    // 让内部吞掉的 rejection 有机会浮出来：若未吞掉，此处会产生 unhandled rejection。
    await Promise.resolve();
  });

  it('ack：SW 应答 ok 返回 true', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
      Promise.resolve({ ok: true })) as never);
    await expect(sendMessageWithAck({ type: 'settings-synced' })).resolves.toBe(true);
  });

  it('ack：SW 应答非 ok 返回 false', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
      Promise.resolve({ ok: false })) as never);
    await expect(sendMessageWithAck({ type: 'settings-synced' })).resolves.toBe(false);
  });

  it('ack：发送异常返回 false（SW 不可达按降级处理，不抛给调用方）', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
      Promise.reject(new Error('no sw'))) as never);
    await expect(sendMessageWithAck({ type: 'settings-synced' })).resolves.toBe(false);
  });

  it('ack：SW 收到但永不应答时按超时降级为 false（否则 await 链永久挂起）', async () => {
    vi.useFakeTimers();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(
      (() => new Promise(() => undefined)) as never
    );
    const pending = sendMessageWithAck({ type: 'settings-synced' });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe(false);
  });
});

describe('onRuntimeMessage 来源与校验闸门', () => {
  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('合法消息被交付', () => {
    const received: Message[] = [];
    const { listener } = registerRuntimeMessage((m) => received.push(m));
    listener({ type: 'focus-search' });
    expect(received).toEqual([{ type: 'focus-search' }]);
  });

  it('未经协议校验的消息被丢弃', () => {
    const received: Message[] = [];
    const { listener } = registerRuntimeMessage((m) => received.push(m));
    listener({ type: 'evil' });
    listener({ nonsense: true });
    listener(null);
    expect(received).toHaveLength(0);
  });

  it('外部来源（sender.id 不匹配）被拦截', () => {
    const received: Message[] = [];
    const { listener } = registerRuntimeMessage((m) => received.push(m));
    listener({ type: 'focus-search' }, { id: 'some-other-extension' });
    expect(received).toHaveLength(0);
    // 未带 sender 的单参数调用必须照常交付：任何 polyfill / 测试桩若在读 sender.id 时
    // 抛 TypeError，异常发生在监听器内会吞掉整条消息通道。
    listener({ type: 'focus-search' });
    expect(received).toHaveLength(1);
  });

  it('注销时移除的是同一函数引用', () => {
    const addSpy = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');
    const removeSpy = vi.spyOn(fakeBrowser.runtime.onMessage, 'removeListener');
    const off = onRuntimeMessage(() => undefined);
    const registered = addSpy.mock.calls.at(-1)?.[0];
    off();
    expect(removeSpy).toHaveBeenCalledWith(registered);
  });
});

describe('watchPendingActions 挂起队列消费', () => {
  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('面板挂载时消费既有队列并清空（执行即清，杜绝重放）', async () => {
    await fakeBrowser.storage.session.set({
      [PENDING_ACTIONS_KEY]: [{ type: 'search-domain', query: 'a.com', at: 1 }]
    });
    const actions: PendingAction[] = [];
    const { off } = registerPendingWatcher((a) => actions.push(a));
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    expect(actions[0]).toEqual({ type: 'search-domain', query: 'a.com', at: 1 });
    await vi.waitFor(async () => {
      const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
      expect(rec[PENDING_ACTIONS_KEY]).toBeUndefined();
    });
    off();
  });

  it('非法条目被逐条丢弃，不阻塞同批其余动作', async () => {
    await fakeBrowser.storage.session.set({
      [PENDING_ACTIONS_KEY]: [
        { type: 'nope' },
        { type: 'locate-active', at: 2 },
        'garbage',
        { type: 'focus-search', at: 3 }
      ]
    });
    const actions: PendingAction[] = [];
    const { off } = registerPendingWatcher((a) => actions.push(a));
    await vi.waitFor(() => expect(actions).toHaveLength(2));
    expect(actions).toEqual([
      { type: 'locate-active', at: 2 },
      { type: 'focus-search', at: 3 }
    ]);
    off();
  });

  it('双通道（初始 get + onChanged）按 at 去重，同一动作只执行一次', async () => {
    const dup = { type: 'focus-search', at: 42 };
    await fakeBrowser.storage.session.set({ [PENDING_ACTIONS_KEY]: [dup] });
    const actions: PendingAction[] = [];
    const { listener, off } = registerPendingWatcher((a) => actions.push(a));
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    // SW 侧 RMW 合并写入时 newValue 会带上已被本面板消费过的旧动作：协议层必须自防重。
    listener({ [PENDING_ACTIONS_KEY]: { newValue: [dup] } }, 'session');
    await Promise.resolve();
    expect(actions).toHaveLength(1);
    off();
  });

  it('无 at 的动作不去重、照常执行（协议允许缺省，无法判定重复）', async () => {
    const bare = { type: 'locate-active' };
    await fakeBrowser.storage.session.set({ [PENDING_ACTIONS_KEY]: [bare] });
    const actions: PendingAction[] = [];
    const { listener, off } = registerPendingWatcher((a) => actions.push(a));
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    listener({ [PENDING_ACTIONS_KEY]: { newValue: [bare] } }, 'session');
    await Promise.resolve();
    expect(actions).toHaveLength(2);
    off();
  });

  it('非 session 区域或非本 key 的变更被忽略', async () => {
    const actions: PendingAction[] = [];
    const { listener, off } = registerPendingWatcher((a) => actions.push(a));
    listener({ [PENDING_ACTIONS_KEY]: { newValue: [{ type: 'focus-search', at: 9 }] } }, 'local');
    listener({ 'other.key': { newValue: 1 } }, 'session');
    await Promise.resolve();
    expect(actions).toHaveLength(0);
    off();
  });

  it('注销时移除的是同一 onChanged 监听器', () => {
    const addSpy = vi.spyOn(fakeBrowser.storage.onChanged, 'addListener');
    const removeSpy = vi.spyOn(fakeBrowser.storage.onChanged, 'removeListener');
    const off = watchPendingActions(() => undefined);
    const registered = addSpy.mock.calls.at(-1)?.[0];
    off();
    expect(removeSpy).toHaveBeenCalledWith(registered);
  });

  it('队列上限是 5（会话存储不无界增长）', () => {
    expect(PENDING_ACTIONS_LIMIT).toBe(5);
  });
});
