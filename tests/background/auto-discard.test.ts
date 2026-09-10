import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import { autoDiscardRepository, settingsRepository } from '@/platform/storage/repositories';
import { updateSession } from '@/platform/storage/session';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import {
  discardInactiveTabs,
  runAutoDiscard,
  syncAutoDiscardAlarm
} from '@/entrypoints/background/autoDiscard';
import { syncCachedSettings } from '@/entrypoints/background/shared';

/**
 * 自动休眠（`alarms` 保活调度）与批量休眠。
 *
 * 这是**唯一会主动冻结用户标签**的自动化路径，误判的代价是用户数据被静默冻结，
 * 因此断言重点是「安全集」的四道排除：白名单 / 固定空间绑定 / 最近访问 / 标签自身状态。
 *
 * 环境说明：`tabs.query` 被替换为可控的标签夹具，且 `tabs.discard` **会真实改写夹具的
 * `discarded` 标志** —— 这不是过度设计：`runAutoDiscard` 末尾的 `pruneAutoDiscardBatch`
 * 会按「批次内是否仍有存活休眠标签」决定是否清空台账。若夹具永远返回 `discarded:false`，
 * prune 必然清空刚写好的台账，测试就变成了在验证错误的行为。
 */

interface FakeTab {
  id: number;
  windowId: number;
  index: number;
  active: boolean;
  pinned: boolean;
  incognito: boolean;
  url: string;
  lastAccessed: number;
  discarded: boolean;
  audible: boolean;
  status: string;
  autoDiscardable: boolean;
}

/** 1 小时前（早于任何合理 cutoff，即「可被休眠」）。 */
function longAgo(): number {
  return Date.now() - 60 * 60_000;
}

function makeTab(partial: Partial<FakeTab> & { id: number; url: string }): FakeTab {
  return {
    windowId: 1,
    index: partial.id,
    active: false,
    pinned: false,
    incognito: false,
    lastAccessed: longAgo(),
    discarded: false,
    audible: false,
    status: 'complete',
    autoDiscardable: true,
    ...partial
  };
}

/** 安装可控的 tabs API；`discard` 真实改写夹具状态，并支持注入失败。 */
function installTabsApi(tabs: FakeTab[], failingDiscardIds: number[] = []) {
  const api = fakeBrowser.tabs as unknown as {
    query: (q: unknown) => Promise<FakeTab[]>;
    discard: (id: number) => Promise<void>;
  };
  api.query = vi.fn(async () => tabs);
  api.discard = vi.fn(async (id: number) => {
    if (failingDiscardIds.includes(id)) throw new Error('discard failed');
    const target = tabs.find((tab) => tab.id === id);
    if (!target) throw new Error('no such tab');
    target.discarded = true;
  });
  return api;
}

async function applySettings(partial: Partial<Settings>): Promise<void> {
  await settingsRepository.write({ ...DEFAULT_SETTINGS, ...partial });
  // recordAutoDiscardBatch 读的是 SW 侧的 cachedSettings（通知开关），必须同步
  await syncCachedSettings();
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
  (fakeBrowser as unknown as { notifications?: unknown }).notifications = {
    create: vi.fn(async () => 'id')
  };
});

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('syncAutoDiscardAlarm', () => {
  it('开启时按 1 分钟周期创建闹钟（alarms 最小粒度，SW 回收后仍能触发）', async () => {
    await syncAutoDiscardAlarm({ ...DEFAULT_SETTINGS, autoDiscardEnabled: true });
    const alarm = await fakeBrowser.alarms.get('tabs-auto-discard');
    expect(alarm?.periodInMinutes).toBe(1);
  });

  it('关闭时清除闹钟（不留每分钟空跑唤醒 SW）', async () => {
    await syncAutoDiscardAlarm({ ...DEFAULT_SETTINGS, autoDiscardEnabled: true });
    await syncAutoDiscardAlarm({ ...DEFAULT_SETTINGS, autoDiscardEnabled: false });
    expect(await fakeBrowser.alarms.get('tabs-auto-discard')).toBeUndefined();
  });
});

describe('runAutoDiscard 安全集', () => {
  it('开关关闭时什么都不做', async () => {
    await applySettings({ autoDiscardEnabled: false });
    const api = installTabsApi([makeTab({ id: 1, url: 'https://a.com/' })]);

    await runAutoDiscard();

    expect(api.discard).not.toHaveBeenCalled();
    expect(await autoDiscardRepository.read()).toBeNull();
  });

  it('休眠超时未访问的非激活标签，并记录可撤销台账', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    installTabsApi([
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://b.com/' })
    ]);

    await runAutoDiscard();

    const batch = await autoDiscardRepository.read();
    expect(batch?.tabIds.sort()).toEqual([1, 2]);
    expect(batch?.count).toBe(2);
    expect(typeof batch?.at).toBe('number');
  });

  it('白名单站点被排除（用户显式保护，绝不被自动冻结）', async () => {
    await applySettings({
      autoDiscardEnabled: true,
      autoDiscardMinutes: 30,
      discardWhitelist: ['keep.com']
    });
    const api = installTabsApi([
      makeTab({ id: 1, url: 'https://keep.com/x' }),
      makeTab({ id: 2, url: 'https://drop.com/x' })
    ]);

    await runAutoDiscard();

    expect(api.discard).toHaveBeenCalledTimes(1);
    expect(api.discard).toHaveBeenCalledWith(2);
    expect((await autoDiscardRepository.read())?.tabIds).toEqual([2]);
  });

  it('固定空间绑定的标签被排除（会话绑定优先于自动化）', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    await updateSession({ itemTabBindings: { 'item-1': 1 } });
    const api = installTabsApi([
      makeTab({ id: 1, url: 'https://bound.com/' }),
      makeTab({ id: 2, url: 'https://free.com/' })
    ]);

    await runAutoDiscard();

    expect(api.discard).toHaveBeenCalledTimes(1);
    expect(api.discard).toHaveBeenCalledWith(2);
  });

  it('最近访问过的标签被排除（未超过等待时长）', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    const api = installTabsApi([
      makeTab({ id: 1, url: 'https://fresh.com/', lastAccessed: Date.now() }),
      makeTab({ id: 2, url: 'https://stale.com/' })
    ]);

    await runAutoDiscard();

    expect(api.discard).toHaveBeenCalledTimes(1);
    expect(api.discard).toHaveBeenCalledWith(2);
  });

  it('标签自身状态不安全时排除：激活 / 固定 / 播放声音 / 加载中 / 已休眠 / 不可自动休眠', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    const api = installTabsApi([
      makeTab({ id: 1, url: 'https://active.com/', active: true }),
      makeTab({ id: 2, url: 'https://pinned.com/', pinned: true }),
      makeTab({ id: 3, url: 'https://audible.com/', audible: true }),
      makeTab({ id: 4, url: 'https://loading.com/', status: 'loading' }),
      makeTab({ id: 5, url: 'https://discarded.com/', discarded: true }),
      makeTab({ id: 6, url: 'https://nodiscard.com/', autoDiscardable: false })
    ]);

    await runAutoDiscard();

    expect(api.discard).not.toHaveBeenCalled();
    expect(await autoDiscardRepository.read()).toBeNull();
  });

  it('discard 失败的标签不计入台账（台账只反映真实冻结）', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    const api = installTabsApi(
      [makeTab({ id: 1, url: 'https://a.com/' }), makeTab({ id: 2, url: 'https://b.com/' })],
      [1]
    );

    await runAutoDiscard();

    expect(api.discard).toHaveBeenCalledTimes(2);
    expect((await autoDiscardRepository.read())?.tabIds).toEqual([2]);
  });

  it('台账清理：批次内标签已全部唤醒时清空（不留无法撤销的陈旧入口）', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    await autoDiscardRepository.write({ tabIds: [900], at: Date.now(), count: 1 });
    // 所有标签都「刚访问过」→ 本轮不产生新的休眠，只剩清理逻辑生效
    installTabsApi([makeTab({ id: 1, url: 'https://a.com/', lastAccessed: Date.now() })]);

    await runAutoDiscard();

    expect(await autoDiscardRepository.read()).toBeNull();
  });

  it('查询异常被就地吞掉并留痕（不得逃逸成 alarms 回调的未捕获 rejection）', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    const api = fakeBrowser.tabs as unknown as { query: () => Promise<never[]> };
    api.query = vi.fn(async () => {
      throw new Error('tabs api down');
    }) as never;

    await expect(runAutoDiscard()).resolves.toBeUndefined();

    expect(readDiagnostics().some((e) => e.message.includes('自动休眠执行失败'))).toBe(true);
  });
});

describe('discardInactiveTabs（浏览器级快捷键 / 右键菜单路径）', () => {
  it('休眠当前窗口非激活的安全标签并写台账', async () => {
    await applySettings({ autoDiscardEnabled: true, discardNotifyEnabled: true });
    installTabsApi([
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://b.com/', active: true })
    ]);

    await discardInactiveTabs();

    const batch = await autoDiscardRepository.read();
    expect(batch?.tabIds).toEqual([1]);
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auto-discarded', tabIds: [1], count: 1 })
    );
  });

  it('无可休眠标签时不写台账（不产生空的「全部唤醒」入口）', async () => {
    await applySettings({ autoDiscardEnabled: true });
    installTabsApi([makeTab({ id: 1, url: 'https://a.com/', active: true })]);

    await discardInactiveTabs();

    expect(await autoDiscardRepository.read()).toBeNull();
  });

  it('查询异常不逃逸（快捷键回调内的 async 函数）', async () => {
    const api = fakeBrowser.tabs as unknown as { query: () => Promise<never[]> };
    api.query = vi.fn(async () => {
      throw new Error('boom');
    }) as never;

    await expect(discardInactiveTabs()).resolves.toBeUndefined();

    expect(readDiagnostics().some((e) => e.message.includes('休眠非激活标签执行失败'))).toBe(true);
  });
});
