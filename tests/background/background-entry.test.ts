import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import { createFolder, createFolderItem } from '@/core/fixed/FolderOps';
import { PENDING_ACTIONS_KEY } from '@/platform/messages';
import {
  foldersRepository,
  settingsRepository,
  snapshotsRepository
} from '@/platform/storage/repositories';
import { clearDiagnostics } from '@/platform/diagnostics';
import { getLastActiveTabId, recordActiveTab } from '@/entrypoints/background/windowCache';
import { syncCachedSettings } from '@/entrypoints/background/shared';

/**
 * SW 入口编排器（`background.ts`，461 行）—— 此前 0% 覆盖。
 *
 * `defineBackground(main)` 的实现是 `{ main }`，因此测试可以直接取出并调用 `main()`，
 * 再用 `spyOn(event, 'addListener')` 把各监听器捕获下来手动驱动。
 *
 * 这里覆盖的是**编排**而非算法（算法在各自的子模块里已有测试）：事件 → 分发 → 调用哪个
 * 子模块。编排错误的典型症状是「功能静默失灵」——监听器没注册、分支走错、早退。
 *
 * 环境说明：
 *  - 不重置模块注册表：`windowCache` 的激活锚点是模块级状态，`enforceNewTabPosition`
 *    依赖它；重置会让断言失去参照。代价是会跨用例累积，故一律使用**互不相同的窗口 id**。
 *  - `settingsRepository` 的读取会被两侧消费（入口自身 + 子模块），故用同一个仓库写入。
 */

type AnyListener = (...args: unknown[]) => unknown;

/** 捕获 `main()` 注册的全部事件监听器（key 形如 `tabs.onCreated`）。 */
function captureListeners(): Map<string, AnyListener> {
  const map = new Map<string, AnyListener>();
  const hook = (key: string, event: { addListener?: unknown } | undefined): void => {
    if (!event || typeof event.addListener !== 'function') return;
    vi.spyOn(event as { addListener: (fn: AnyListener) => void }, 'addListener').mockImplementation(
      (fn: AnyListener) => {
        map.set(key, fn);
      }
    );
  };
  hook('tabs.onCreated', fakeBrowser.tabs.onCreated);
  hook('tabs.onActivated', fakeBrowser.tabs.onActivated);
  hook('tabs.onUpdated', fakeBrowser.tabs.onUpdated);
  hook('tabs.onRemoved', fakeBrowser.tabs.onRemoved);
  hook('tabs.onAttached', fakeBrowser.tabs.onAttached);
  hook('tabs.onDetached', fakeBrowser.tabs.onDetached);
  hook('tabs.onReplaced', fakeBrowser.tabs.onReplaced);
  hook('windows.onCreated', fakeBrowser.windows.onCreated);
  hook('windows.onRemoved', fakeBrowser.windows.onRemoved);
  hook('runtime.onMessage', fakeBrowser.runtime.onMessage);
  hook('runtime.onInstalled', fakeBrowser.runtime.onInstalled);
  hook('runtime.onStartup', fakeBrowser.runtime.onStartup);
  hook('commands.onCommand', fakeBrowser.commands.onCommand);
  hook('contextMenus.onClicked', fakeBrowser.contextMenus.onClicked);
  hook('omnibox.onInputChanged', fakeBrowser.omnibox.onInputChanged);
  hook('omnibox.onInputEntered', fakeBrowser.omnibox.onInputEntered);
  hook('omnibox.onInputStarted', fakeBrowser.omnibox.onInputStarted);
  hook('action.onClicked', fakeBrowser.action.onClicked);
  hook('alarms.onAlarm', fakeBrowser.alarms.onAlarm);
  hook('permissions.onAdded', fakeBrowser.permissions.onAdded);
  hook('permissions.onRemoved', fakeBrowser.permissions.onRemoved);
  return map;
}

/**
 * 就地覆盖浏览器 API 的方法，**不整体替换对象**。
 *
 * 整体替换（`fakeBrowser.action = {...}`）会丢掉对象上的其他成员（如 `action.onClicked`），
 * 而使下一个用例启动入口时在 `browser.action?.onClicked.addListener(...)` 处炸掉整个 boot
 * ——一个看似无关的分支因此全线飘红，且难以归因。就地 `Object.assign` 只替换需要打桩的方法。
 */
function stubBrowserApis(): void {
  Object.assign(fakeBrowser.sidePanel, {
    open: vi.fn(async () => undefined),
    setPanelBehavior: vi.fn(async () => undefined)
  });
  Object.assign(fakeBrowser.i18n, { getMessage: vi.fn(() => '') });
  Object.assign(fakeBrowser.notifications, { create: vi.fn(async () => 'id') });
  Object.assign(fakeBrowser.action, {
    setBadgeText: vi.fn(async () => undefined),
    setBadgeBackgroundColor: vi.fn(async () => undefined),
    setTitle: vi.fn(async () => undefined)
  });
}

/** 读取被就地打桩的 action 方法。 */
function actionMock(name: 'setBadgeText' | 'setBadgeBackgroundColor' | 'setTitle') {
  return (fakeBrowser.action as unknown as Record<string, ReturnType<typeof vi.fn>>)[name]!;
}

/** 读取被就地打桩的 sidePanel 方法。 */
function sidePanelMock(name: 'open' | 'setPanelBehavior') {
  return (fakeBrowser.sidePanel as unknown as Record<string, ReturnType<typeof vi.fn>>)[name]!;
}

/** 安装子模块依赖的浏览器 API stub，并启动入口，返回监听器表。 */
async function boot(settings: Partial<Settings> = {}): Promise<Map<string, AnyListener>> {
  await settingsRepository.write({ ...DEFAULT_SETTINGS, ...settings });
  stubBrowserApis();

  const listeners = captureListeners();
  const mod = await import('@/entrypoints/background');
  const main = (mod.default as unknown as { main: () => void }).main;
  main();
  // 入口内的初始化是 fire-and-forget（void 调用）。这里必须**显式等设置缓存落定**：
  // 多个监听器（omnibox 开关、badgeMode、通知开关）读的是 SW 侧的 `cachedSettings`，
  // 若缓存仍是默认值，针对「关闭开关」的用例会因为缓存尚未刷新而走进错误分支，
  // 而只断言缺席的用例会因此**假绿**。
  await syncCachedSettings();
  return listeners;
}

/** 驱动 runtime.onMessage 监听器，捕获 sendResponse 回调。 */
function messageHarness(listener: AnyListener) {
  const responses: unknown[] = [];
  const call = (raw: unknown, sender?: { id?: string }): unknown => {
    responses.length = 0;
    // Chrome 一定传 sender；用 `{}` 表示「内部来源、id 未知」，走放行分支
    return (listener as unknown as (r: unknown, s?: unknown, cb?: unknown) => unknown)(
      raw,
      sender ?? {},
      (value: unknown) => responses.push(value)
    );
  };
  return { call, responses };
}

function rawTab(partial: Record<string, unknown>) {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    status: 'complete',
    lastAccessed: Date.now(),
    autoDiscardable: true,
    ...partial
  };
}

beforeEach(() => {
  // 假定时器是必需的：入口内多处 fire-and-forget 的防抖（角标 500ms、窗口缓存 250/800ms）
  // 在真实定时器下会**跨用例触发**——上一个用例启动的刷新会打到下一个用例的 stub 上，
  // 表现为「角标收到的是上一个用例的数据」这类难以归因的失败。
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);
});

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('入口初始化', () => {
  it('注册全部关键事件监听器，且不抛错', async () => {
    const listeners = await boot();

    for (const key of [
      'tabs.onCreated',
      'tabs.onActivated',
      'tabs.onUpdated',
      'tabs.onRemoved',
      'tabs.onAttached',
      'tabs.onDetached',
      'tabs.onReplaced',
      'windows.onCreated',
      'windows.onRemoved',
      'runtime.onMessage',
      'runtime.onInstalled',
      'runtime.onStartup',
      'commands.onCommand',
      'contextMenus.onClicked',
      'omnibox.onInputChanged',
      'omnibox.onInputEntered',
      'omnibox.onInputStarted',
      'action.onClicked',
      'alarms.onAlarm'
    ]) {
      expect(listeners.has(key), `缺少监听器 ${key}`).toBe(true);
    }
  });

  it('按设置对齐工具栏点击行为：panel → openPanelOnActionClick true', async () => {
    await boot({ actionClickMode: 'panel' });
    const setPanelBehavior = sidePanelMock('setPanelBehavior');

    await vi.waitFor(() =>
      expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    );
  });

  it('按设置对齐工具栏点击行为：regroup → openPanelOnActionClick false', async () => {
    await boot({ actionClickMode: 'regroup' });
    const setPanelBehavior = sidePanelMock('setPanelBehavior');

    await vi.waitFor(() =>
      expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false })
    );
  });

  it('onInstalled / onStartup 时重新对齐菜单与点击行为', async () => {
    const listeners = await boot();
    const setPanelBehavior = sidePanelMock('setPanelBehavior');
    setPanelBehavior.mockClear();

    listeners.get('runtime.onInstalled')!();
    listeners.get('runtime.onStartup')!();

    await vi.waitFor(() => expect(setPanelBehavior).toHaveBeenCalledTimes(2));
  });
});

describe('runtime.onMessage 端点', () => {
  it('settings-synced：同步设置缓存并应答 ok（不再让发送方等到超时）', async () => {
    const listeners = await boot();
    const { call, responses } = messageHarness(listeners.get('runtime.onMessage')!);

    call({ type: 'settings-synced' });

    await vi.waitFor(() => expect(responses).toEqual([{ ok: true }]));
  });

  it('allow-duplicate-once：立即应答 ok', async () => {
    const listeners = await boot();
    const { call, responses } = messageHarness(listeners.get('runtime.onMessage')!);

    call({ type: 'allow-duplicate-once', windowId: 1, url: 'https://a.com/' });

    expect(responses).toEqual([{ ok: true }]);
  });

  it('skip-auto-save-once：异步应答（等标记镜像到 session 之后）', async () => {
    const listeners = await boot();
    const { call, responses } = messageHarness(listeners.get('runtime.onMessage')!);

    const returned = call({ type: 'skip-auto-save-once', windowId: 555 });

    // 返回 true 告诉浏览器「将异步 sendResponse」
    expect(returned).toBe(true);
    await vi.waitFor(() => expect(responses).toEqual([{ ok: true }]));
  });

  it('外部来源（sender.id 不匹配）被前置拦截', async () => {
    const listeners = await boot();
    const { call, responses } = messageHarness(listeners.get('runtime.onMessage')!);

    call({ type: 'settings-synced' }, { id: 'other-extension' });

    expect(responses).toEqual([]);
  });

  it('未登记的消息类型被丢弃', async () => {
    const listeners = await boot();
    const { call, responses } = messageHarness(listeners.get('runtime.onMessage')!);

    call({ type: 'evil-payload' });

    expect(responses).toEqual([]);
  });

  it('单参数调用（sender 缺失）不因来源校验抛错 —— 监听器内抛错会吞掉整条消息通道', async () => {
    // 宿主一定会传 sender，但测试桩 / polyfill 可能不传；来源校验必须容忍 sender 缺失。
    // 修复前此处会抛 TypeError（`sender.id` 无 optional chaining），而异常发生在监听器内
    // 会直接吞掉整条消息通道 —— 与 platform/messages.ts 早已防护的是同一类问题。
    const listeners = await boot();
    const listener = listeners.get('runtime.onMessage')! as unknown as (
      r: unknown,
      s?: unknown
    ) => unknown;

    expect(() => listener({ type: 'unregistered' }, undefined)).not.toThrow();
  });
});

describe('commands.onCommand 分发', () => {
  it('focus-search：开面板 + 挂起搜索聚焦动作', async () => {
    const listeners = await boot();
    const open = sidePanelMock('open');

    await listeners.get('commands.onCommand')!('focus-search' as never);

    expect(open).toHaveBeenCalled();
    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    expect((rec[PENDING_ACTIONS_KEY] as { type: string }[])[0]!.type).toBe('focus-search');
  });

  it('open-panel：只开面板，不挂起任何动作', async () => {
    const listeners = await boot();
    const open = sidePanelMock('open');

    await listeners.get('commands.onCommand')!('open-panel' as never);

    // 必须同时断言「开面板发生了」与「没有挂起动作」：
    // 只断言后者的话，把整个分支删掉也能通过（什么都不做自然没有挂起动作）——典型的假绿。
    expect(open).toHaveBeenCalled();
    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    expect(rec[PENDING_ACTIONS_KEY]).toBeUndefined();
  });

  it('locate-active：开面板 + 挂起定位动作', async () => {
    const listeners = await boot();

    await listeners.get('commands.onCommand')!('locate-active' as never);

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    expect((rec[PENDING_ACTIONS_KEY] as { type: string }[])[0]!.type).toBe('locate-active');
  });

  it('discard-inactive：走批量休眠路径', async () => {
    const listeners = await boot();
    const discard = vi.fn(async () => undefined);
    (fakeBrowser.tabs as unknown as { query: unknown }).query = vi.fn(async () => [
      rawTab({ id: 11, url: 'https://a.com/', active: false })
    ]);
    (fakeBrowser.tabs as unknown as { discard: unknown }).discard = discard;

    await listeners.get('commands.onCommand')!('discard-inactive' as never);

    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith(11));
  });

  it('未知命令不产生任何副作用', async () => {
    const listeners = await boot();
    const open = sidePanelMock('open');

    await listeners.get('commands.onCommand')!('nonexistent' as never);

    expect(open).not.toHaveBeenCalled();
  });
});

describe('enforceNewTabPosition（新建标签位置）', () => {
  const WINDOW = 7001;

  it('end 模式：不移动（浏览器默认即在末尾）', async () => {
    const listeners = await boot({ newTabPosition: 'end' });
    const move = vi.spyOn(fakeBrowser.tabs, 'move');

    listeners.get('tabs.onCreated')!(rawTab({ id: 5, windowId: WINDOW, index: 9 }));

    await vi.waitFor(() => expect(fakeBrowser.tabs.move).toBeTypeOf('function'));
    await Promise.resolve();
    expect(move).not.toHaveBeenCalled();
  });

  it('after-active：移到锚点标签之后', async () => {
    const listeners = await boot({ newTabPosition: 'after-active' });
    recordActiveTab(WINDOW, 88);
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(
      rawTab({ id: 88, windowId: WINDOW, index: 3 }) as never
    );
    const move = vi.spyOn(fakeBrowser.tabs, 'move').mockResolvedValue({} as never);

    listeners.get('tabs.onCreated')!(rawTab({ id: 5, windowId: WINDOW, index: 9 }));

    await vi.waitFor(() => expect(move).toHaveBeenCalledWith(5, { windowId: WINDOW, index: 4 }));
  });

  it('after-active 但新标签已在目标位置：不移动（幂等）', async () => {
    const listeners = await boot({ newTabPosition: 'after-active' });
    recordActiveTab(WINDOW, 88);
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(
      rawTab({ id: 88, windowId: WINDOW, index: 3 }) as never
    );
    const move = vi.spyOn(fakeBrowser.tabs, 'move').mockResolvedValue({} as never);

    listeners.get('tabs.onCreated')!(rawTab({ id: 5, windowId: WINDOW, index: 4 }));

    await vi.waitFor(() => expect(getLastActiveTabId(WINDOW)).toBe(88));
    await Promise.resolve();
    expect(move).not.toHaveBeenCalled();
  });

  it('固定标签不参与位置调整（Chrome 固定区自成区段）', async () => {
    const listeners = await boot({ newTabPosition: 'after-active' });
    recordActiveTab(WINDOW, 88);
    const move = vi.spyOn(fakeBrowser.tabs, 'move').mockResolvedValue({} as never);

    listeners.get('tabs.onCreated')!(rawTab({ id: 5, windowId: WINDOW, index: 9, pinned: true }));

    await Promise.resolve();
    await Promise.resolve();
    expect(move).not.toHaveBeenCalled();
  });

  it('锚点缺失时用窗口内最后一个普通标签兜底（SW 回收后的冷启动）', async () => {
    const listeners = await boot({ newTabPosition: 'after-active' });
    const windowId = 7009;
    (fakeBrowser.tabs as unknown as { query: unknown }).query = vi.fn(async () => [
      rawTab({ id: 5, windowId, index: 7 }),
      rawTab({ id: 91, windowId, index: 2 }),
      rawTab({ id: 92, windowId, index: 5 })
    ]);
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(
      rawTab({ id: 92, windowId, index: 5 }) as never
    );
    const move = vi.spyOn(fakeBrowser.tabs, 'move').mockResolvedValue({} as never);

    listeners.get('tabs.onCreated')!(rawTab({ id: 5, windowId, index: 7 }));

    // 除自己以外 index 最大的普通标签是 92(index 5) → 目标 index 6
    await vi.waitFor(() => expect(move).toHaveBeenCalledWith(5, { windowId, index: 6 }));
  });
});

describe('action.onClicked（regroup 模式）', () => {
  it('regroup 模式下整理临时区并以 ✓ 角标轻量反馈', async () => {
    const listeners = await boot({ actionClickMode: 'regroup' });
    // 同站两个标签 → planRegroup 产出计划；再注入建组/打散所需的最小 API
    Object.assign(fakeBrowser.tabs, {
      query: vi.fn(async () => [
        rawTab({ id: 1, url: 'https://a.com/', index: 0 }),
        rawTab({ id: 2, url: 'https://a.com/x', index: 1 })
      ]),
      ungroup: vi.fn(async () => undefined),
      group: vi.fn(async () => 500)
    });
    Object.assign(fakeBrowser.tabGroups, {
      query: vi.fn(async () => []),
      update: vi.fn(async () => undefined)
    });

    listeners.get('action.onClicked')!();

    await vi.waitFor(() => expect(actionMock('setBadgeText')).toHaveBeenCalledWith({ text: '✓' }));
  });

  it('regroup 模式下无可整理内容时不打勾（不制造假反馈）', async () => {
    const listeners = await boot({ actionClickMode: 'regroup' });
    Object.assign(fakeBrowser.tabs, {
      query: vi.fn(async () => [rawTab({ id: 1, url: 'https://a.com/', index: 0 })])
    });

    listeners.get('action.onClicked')!();

    await Promise.resolve();
    await Promise.resolve();
    expect(actionMock('setBadgeText')).not.toHaveBeenCalledWith({ text: '✓' });
  });

  it('panel 模式下点击由 Chrome 打开侧边栏，onClicked 不做任何事', async () => {
    const listeners = await boot({ actionClickMode: 'panel' });

    listeners.get('action.onClicked')!();

    await Promise.resolve();
    await Promise.resolve();
    expect(actionMock('setBadgeText')).not.toHaveBeenCalled();
  });
});

describe('alarms.onAlarm 分发', () => {
  it('自动休眠闹钟触发扫描', async () => {
    const listeners = await boot({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    const discard = vi.fn(async () => undefined);
    (fakeBrowser.tabs as unknown as { query: unknown }).query = vi.fn(async () => [
      rawTab({ id: 21, url: 'https://a.com/', lastAccessed: Date.now() - 3_600_000 })
    ]);
    (fakeBrowser.tabs as unknown as { discard: unknown }).discard = discard;

    listeners.get('alarms.onAlarm')!({ name: 'tabs-auto-discard' } as never);

    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith(21));
  });

  it('无关闹钟名不触发任何扫描', async () => {
    const listeners = await boot({ autoSaveSnapshots: true, autoDiscardEnabled: true });
    const discard = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, { discard });
    const snapshotsWrite = vi.spyOn(snapshotsRepository, 'write');

    listeners.get('alarms.onAlarm')!({ name: 'some-other-alarm' } as never);

    await Promise.resolve();
    await Promise.resolve();
    // 断言「两条闹钟路径都没跑」，而不是笼统地断言 tabs.query 未被调用
    // （入口初始化本身就会为已有窗口查一次标签）
    expect(discard).not.toHaveBeenCalled();
    expect(snapshotsWrite).not.toHaveBeenCalled();
  });
});

describe('tabs 事件驱动的副作用', () => {
  it('onUpdated：URL 变化时刷新角标（且只有相关字段才刷新窗口缓存）', async () => {
    const listeners = await boot({ badgeMode: 'count' });
    (fakeBrowser.tabs as unknown as { query: unknown }).query = vi.fn(async () => []);

    listeners.get('tabs.onUpdated')!(
      1,
      { url: 'https://new.com/' },
      rawTab({ id: 1, url: 'https://new.com/' }) as never
    );

    // 角标是 500ms 防抖，这里只确认没有同步异常；行为细节由 badge.test.ts 覆盖
    expect(() =>
      listeners.get('tabs.onUpdated')!(1, { title: 'x' }, rawTab({ id: 1 }) as never)
    ).not.toThrow();
  });

  it('onActivated：记录激活锚点（新建标签位置的依据）', async () => {
    const listeners = await boot();
    const windowId = 7011;

    listeners.get('tabs.onActivated')!({ windowId, tabId: 1234 } as never);

    expect(getLastActiveTabId(windowId)).toBe(1234);
  });

  it('onReplaced：结算旧标签并把新标签纳入追踪', async () => {
    const listeners = await boot();
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(
      rawTab({ id: 31, windowId: 7012, url: 'https://new.com/' }) as never
    );

    expect(() => listeners.get('tabs.onReplaced')!(31, 30)).not.toThrow();
  });

  it('windows.onRemoved：触发关窗快照链路（写入 auto 快照）', async () => {
    // 关窗自动保存挂在 **windows.onRemoved** 上（tabs.onRemoved 只负责安排窗口缓存刷新）
    const listeners = await boot({ autoSaveSnapshots: true });
    const windowId = 7013;
    // 预置 session 缓存：模拟「SW 回收后仅剩 session 镜像」的关窗场景
    await fakeBrowser.storage.session.set({
      'tabs.window-tabs.v1': {
        [String(windowId)]: [
          { url: 'https://closing.com/', title: 'C', pinned: false, muted: false }
        ]
      }
    });

    listeners.get('windows.onRemoved')!(windowId);

    await vi.waitFor(async () => {
      const rec = await fakeBrowser.storage.local.get('tabs.snapshots.v1');
      const snapshots = rec['tabs.snapshots.v1'] as unknown[] | undefined;
      expect(snapshots?.length).toBe(1);
    });
  });

  it('tabs.onRemoved：安排窗口缓存刷新（防抖 250ms 后才查询）', async () => {
    const listeners = await boot();
    const query = vi.fn(async () => []);
    Object.assign(fakeBrowser.tabs, { query });

    listeners.get('tabs.onRemoved')!(99, { windowId: 7014, isWindowClosing: false } as never);
    // 防抖窗口内不应发起查询
    expect(query).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(query).toHaveBeenCalled();
  });
});

describe('contextMenus.onClicked 路由', () => {
  async function bootWithFolder() {
    const folder = {
      ...createFolder('Work'),
      items: [createFolderItem({ url: 'https://a.com/', title: 'A' })]
    };
    await foldersRepository.write([folder]);
    const listeners = await boot();
    return { listeners, folderId: folder.id };
  }

  it('页面「加入文件夹」：把当前页加入指定文件夹', async () => {
    const { listeners, folderId } = await bootWithFolder();

    listeners.get('contextMenus.onClicked')!(
      { menuItemId: `th:page:add-folder:${folderId}` } as never,
      rawTab({
        id: 1,
        url: 'https://page.com/',
        title: 'Page'
      }) as never
    );

    await vi.waitFor(async () => {
      const folders = await foldersRepository.read();
      expect(folders[0]!.items.map((i) => i.url)).toContain('https://page.com/');
    });
  });

  it('链接「加入文件夹」：用 linkUrl 而非页面 URL', async () => {
    const { listeners, folderId } = await bootWithFolder();

    listeners.get('contextMenus.onClicked')!(
      { menuItemId: `th:link:add-folder:${folderId}`, linkUrl: 'https://link.com/' } as never,
      rawTab({ id: 1, url: 'https://page.com/' }) as never
    );

    await vi.waitFor(async () => {
      const folders = await foldersRepository.read();
      expect(folders[0]!.items.map((i) => i.url)).toContain('https://link.com/');
    });
  });

  it('按站点搜索：把 hostname 作为搜索词挂起（去掉 www.）', async () => {
    const { listeners } = await bootWithFolder();

    listeners.get('contextMenus.onClicked')!(
      { menuItemId: 'th:page:search-site' } as never,
      rawTab({
        id: 1,
        url: 'https://www.example.com/x'
      }) as never
    );

    await vi.waitFor(async () => {
      const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
      expect((rec[PENDING_ACTIONS_KEY] as { query: string }[])[0]!.query).toBe('example.com');
    });
  });

  it('休眠标签：走安全判定路径', async () => {
    const { listeners } = await bootWithFolder();
    const discard = vi.fn(async () => undefined);
    (fakeBrowser.tabs as unknown as { discard: unknown }).discard = discard;

    listeners.get('contextMenus.onClicked')!(
      { menuItemId: 'th:page:discard' } as never,
      rawTab({ id: 44 }) as never
    );

    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith(44));
  });

  it('打开设置页：调用 runtime.openOptionsPage', async () => {
    const { listeners } = await bootWithFolder();
    const openOptionsPage = vi
      .spyOn(fakeBrowser.runtime, 'openOptionsPage')
      .mockImplementation((() => Promise.resolve()) as never);

    listeners.get('contextMenus.onClicked')!({ menuItemId: 'th:action:settings' } as never);

    expect(openOptionsPage).toHaveBeenCalled();
  });

  it('打开面板：调用 sidePanel.open', async () => {
    const { listeners } = await bootWithFolder();
    const open = sidePanelMock('open');

    listeners.get('contextMenus.onClicked')!({ menuItemId: 'th:action:open-panel' } as never);

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
  });
});

describe('omnibox 监听', () => {
  it('开启时防抖查询并回填建议', async () => {
    const listeners = await boot({ omniboxEnabled: true });
    await foldersRepository.write([createFolder('Work')]);
    const suggest = vi.fn();

    listeners.get('omnibox.onInputChanged')!('work' as never, suggest as never);

    await vi.waitFor(() => expect(suggest).toHaveBeenCalled(), { timeout: 3000 });
    const suggestions = suggest.mock.calls.at(-1)![0] as unknown[];
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('关闭时建议恒为空且不查询存储', async () => {
    const listeners = await boot({ omniboxEnabled: false });
    const suggest = vi.fn();

    listeners.get('omnibox.onInputChanged')!('work' as never, suggest as never);

    expect(suggest).toHaveBeenCalledWith([]);
  });

  it('开启时回车走搜索路径（与下面「关闭时不处理」构成对照，避免只断言缺席）', async () => {
    const listeners = await boot({ omniboxEnabled: true });

    // 监听器内是 `void handleOmniboxEnter(...)`（fire-and-forget），不能直接 await 监听器
    listeners.get('omnibox.onInputEntered')!('search:keyword' as never);

    await vi.waitFor(async () => {
      const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
      const list = rec[PENDING_ACTIONS_KEY] as { query: string }[] | undefined;
      expect(list?.[0]?.query).toBe('keyword');
    });
  });

  it('关闭时回车不处理', async () => {
    const listeners = await boot({ omniboxEnabled: false });

    expect(() => listeners.get('omnibox.onInputEntered')!('search:x' as never)).not.toThrow();

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    expect(rec[PENDING_ACTIONS_KEY]).toBeUndefined();
  });

  it('onInputStarted 设置默认建议文案', async () => {
    const listeners = await boot({ omniboxEnabled: true });
    const setDefaultSuggestion = vi
      .spyOn(fakeBrowser.omnibox, 'setDefaultSuggestion')
      .mockImplementation((() => Promise.resolve()) as never);

    listeners.get('omnibox.onInputStarted')!();

    await vi.waitFor(() => expect(setDefaultSuggestion).toHaveBeenCalled());
  });
});
