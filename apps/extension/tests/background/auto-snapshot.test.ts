import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings, type Snapshot } from '@/core/schema/models';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { runAutoSnapshot, syncAutoSnapshotAlarm } from '@/platform/background/autoSnapshot';

/**
 * 定时自动快照行为规格：开关关闭时不保存；现场未变化时不重复写入；闹钟周期与用户设置一致。
 * 测试桩为无原生标签组场景提供空查询，并为目标窗口创建测试标签。
 */

/** 注入 tabGroups.query 最小实现：当前窗口无原生标签组。 */
function stubTabGroupsQuery(): void {
  const tabGroups = fakeBrowser.tabGroups as unknown as { query: () => Promise<never[]> };
  tabGroups.query = vi.fn(async () => [] as never[]);
}

function makeSnapshot(partial: Partial<Snapshot>): Snapshot {
  return {
    id: 's1',
    name: '自动快照',
    origin: 'auto',
    createdAt: Date.now(),
    tabCount: 1,
    tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }],
    ...partial
  };
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('定时自动快照', () => {
  beforeEach(() => {
    stubTabGroupsQuery();
  });

  it('开关关闭时完全不写入（默认关闭语义）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: false });
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });
    const writeSpy = vi.spyOn(snapshotsRepository, 'write');

    await runAutoSnapshot();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(await snapshotsRepository.read()).toHaveLength(0);
  });

  it('开启后为有标签的窗口写入一份 auto 快照', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });

    await runAutoSnapshot();

    const all = await snapshotsRepository.read();
    expect(all).toHaveLength(1);
    expect(all[0]!.origin).toBe('auto');
    expect(all[0]!.tabs[0]!.url).toBe('https://a.com/');
  });

  it('内容与最新自动快照相同则不重复写入（去重防噪音）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });
    // 预置一份与当前现场完全相同的自动快照
    await snapshotsRepository.write([makeSnapshot({ id: 'existing' })]);
    const writeSpy = vi.spyOn(snapshotsRepository, 'write');

    await runAutoSnapshot();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(await snapshotsRepository.read()).toHaveLength(1);
  });

  it('闹钟周期等于设置值，关闭开关时清除闹钟', async () => {
    await syncAutoSnapshotAlarm({
      ...DEFAULT_SETTINGS,
      autoSaveSnapshots: true,
      autoSnapshotIntervalMin: 30
    });
    const created = await fakeBrowser.alarms.get('tabs-auto-snapshot');
    expect(created?.periodInMinutes).toBe(30);

    await syncAutoSnapshotAlarm({ ...DEFAULT_SETTINGS, autoSaveSnapshots: false });
    expect(await fakeBrowser.alarms.get('tabs-auto-snapshot')).toBeUndefined();
  });
});

/**
 * 设置变更与闹钟重建。
 *
 * 同名 `alarms.create` 会**重置**触发时间，故「任意设置写入都重建闹钟」等于把
 * 「每 N 分钟一次」的自动快照无限期推后 —— 而设置写入远比开关变更频繁（切空间写
 * `activeSpaceId`、引导标记 `tipSeen` / `onboarded` 都会触发 watch）。
 * 这里锁的是入口的编排：只有开关 / 周期真的变了才重建。
 */
describe('设置变更时的闹钟重建（无关设置不得推后自动快照）', () => {
  const ALARMS_ON: Partial<Settings> = {
    autoSaveSnapshots: true,
    autoSnapshotIntervalMin: 30,
    autoDiscardEnabled: true
  };

  /** 启动 SW 入口所需的最小浏览器桩（与 background-entry.test.ts 同口径）。 */
  function stubBrowserApis(): void {
    Object.assign(fakeBrowser.sidePanel, {
      open: vi.fn(async () => undefined),
      setPanelBehavior: vi.fn(async () => undefined)
    });
    Object.assign(fakeBrowser.i18n, { getMessage: vi.fn(() => '') });
    Object.assign(fakeBrowser.notifications, { create: vi.fn(async () => 'id') });
    Object.assign(fakeBrowser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://fake-id${path}`),
      setUninstallURL: vi.fn(async () => undefined)
    });
    Object.assign(fakeBrowser.action, {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setTitle: vi.fn(async () => undefined)
    });
    // 入口启动期注册的其余事件：fake-browser 未实现它们的 addListener，
    // 不打桩会在 `main()` 内抛错（清单与 background-entry.test.ts 同源）。
    const noop = () => undefined;
    for (const event of [
      fakeBrowser.tabs.onCreated,
      fakeBrowser.tabs.onActivated,
      fakeBrowser.tabs.onUpdated,
      fakeBrowser.tabs.onRemoved,
      fakeBrowser.tabs.onAttached,
      fakeBrowser.tabs.onDetached,
      fakeBrowser.tabs.onReplaced,
      fakeBrowser.windows.onCreated,
      fakeBrowser.windows.onRemoved,
      fakeBrowser.runtime.onMessage,
      fakeBrowser.runtime.onInstalled,
      fakeBrowser.runtime.onStartup,
      fakeBrowser.commands.onCommand,
      fakeBrowser.contextMenus.onClicked,
      fakeBrowser.omnibox.onInputChanged,
      fakeBrowser.omnibox.onInputEntered,
      fakeBrowser.omnibox.onInputStarted,
      fakeBrowser.action.onClicked,
      fakeBrowser.alarms.onAlarm,
      fakeBrowser.permissions.onAdded,
      fakeBrowser.permissions.onRemoved
    ]) {
      vi.spyOn(event, 'addListener').mockImplementation(noop as never);
    }
  }

  /**
   * 启动入口并等启动期的闹钟对齐落定。
   *
   * `vi.resetModules()` 是必需的：入口模块会被缓存，重复 `main()` 会注册**第二份**
   * `settingsRepository.watch`，而上一份闭包里的闹钟签名仍是旧值 —— 随后的写入会让
   * 两份闭包各自判定，「重建一次」的断言因此失去意义（也会让前一条用例的结果串味）。
   */
  async function bootEntry(settings: Partial<Settings>): Promise<void> {
    vi.resetModules();
    await settingsRepository.write({ ...DEFAULT_SETTINGS, ...settings });
    stubBrowserApis();
    const mod = await import('@/entrypoints/background');
    (mod.default as unknown as { main: () => void }).main();
    await vi.advanceTimersByTimeAsync(0);
    // 等到启动对齐真的建出闹钟：不等就 spy 的话，下面「未调用」的断言会因为
    // 「启动期那次 create 还没发生」而假绿。
    await vi.waitFor(async () => {
      expect(await fakeBrowser.alarms.get('tabs-auto-snapshot')).toBeDefined();
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('写入与闹钟无关的设置（sortMode）不重建闹钟', async () => {
    await bootEntry(ALARMS_ON);
    const create = vi.spyOn(fakeBrowser.alarms, 'create');

    await settingsRepository.write({ ...DEFAULT_SETTINGS, ...ALARMS_ON, sortMode: 'recency' });
    await vi.advanceTimersByTimeAsync(50);

    expect(create).not.toHaveBeenCalled();
  });

  it('SW 重启（内存签名归零）不重建同周期闹钟', async () => {
    // Given: 已按当前设置建好闹钟
    await bootEntry(ALARMS_ON);
    const create = vi.spyOn(fakeBrowser.alarms, 'create');

    // When: 模拟 SW 被回收后重新唤醒 —— 闭包里的签名是 undefined，只能靠浏览器侧闹钟判定
    await bootEntry(ALARMS_ON);

    // Then: 不得重建（同名 create 会把「每 30 分钟」无限期推后）
    expect(create).not.toHaveBeenCalled();
  });

  it('间隔 30 → 60 时才重建一次（周期变化必须生效）', async () => {
    await bootEntry(ALARMS_ON);
    const create = vi.spyOn(fakeBrowser.alarms, 'create');

    await settingsRepository.write({
      ...DEFAULT_SETTINGS,
      ...ALARMS_ON,
      autoSnapshotIntervalMin: 60
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('tabs-auto-snapshot', {
      periodInMinutes: 60,
      delayInMinutes: 60
    });
  });
});
