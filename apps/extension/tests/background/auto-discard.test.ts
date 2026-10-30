import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import { autoDiscardRepository, settingsRepository } from '@/platform/storage/repositories';
import { updateSession } from '@/platform/storage/session';
import { appendAutoDiscardBatch } from '@/platform/storage/autoDiscardLedger';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import {
  discardInactiveTabs,
  runAutoDiscard,
  syncAutoDiscardAlarm
} from '@/platform/background/autoDiscard';
import { syncCachedSettings } from '@/platform/background/shared';
import { t } from '@/i18n/headless';

/**
 * 自动休眠行为规格：仅处理满足条件的后台标签，并排除白名单、固定空间绑定、近期访问及
 * 不适合休眠的标签状态；批量休眠会记录实际成功的标签。
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
    expect(await autoDiscardRepository.read()).toEqual([]);
  });

  it('休眠超时未访问的后台标签，并记录可撤销台账', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    installTabsApi([
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://b.com/' })
    ]);

    await runAutoDiscard();

    const [batch] = await autoDiscardRepository.read();
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
    expect((await autoDiscardRepository.read())[0]?.tabIds).toEqual([2]);
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
    expect(await autoDiscardRepository.read()).toEqual([]);
  });

  it('discard 失败的标签不计入台账（台账只反映真实冻结）', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    const api = installTabsApi(
      [makeTab({ id: 1, url: 'https://a.com/' }), makeTab({ id: 2, url: 'https://b.com/' })],
      [1]
    );

    await runAutoDiscard();

    expect(api.discard).toHaveBeenCalledTimes(2);
    expect((await autoDiscardRepository.read())[0]?.tabIds).toEqual([2]);
  });

  it('台账清理：批次内标签已全部唤醒时清空（不留无法撤销的陈旧入口）', async () => {
    await applySettings({ autoDiscardEnabled: true, autoDiscardMinutes: 30 });
    await autoDiscardRepository.write([{ tabIds: [900], at: Date.now(), count: 1 }]);
    // 所有标签都「刚访问过」→ 本次执行不产生新的休眠，只清理现有台账
    installTabsApi([makeTab({ id: 1, url: 'https://a.com/', lastAccessed: Date.now() })]);

    await runAutoDiscard();

    expect(await autoDiscardRepository.read()).toEqual([]);
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

describe('自动休眠台账写前基线', () => {
  it('读取故障时追加失败且不覆盖既有批次', async () => {
    // Given: 磁盘已有尚未唤醒的批次，写前读取发生 I/O 故障
    const key = 'tabs.auto-discard-batch.v1';
    const existing = [{ tabIds: [1], at: 100, count: 1 }];
    await autoDiscardRepository.write(existing);
    const writeSpy = vi.spyOn(autoDiscardRepository, 'write');
    const original = fakeBrowser.storage.local.get.bind(fakeBrowser.storage.local);
    const getSpy = vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation((async (
      requested: string
    ) => {
      if (requested === key) throw new Error('storage read failed');
      return original(requested);
    }) as never);

    // When: 追加新一轮休眠批次
    const persisted = await appendAutoDiscardBatch([2], 200);

    // Then: 操作中止，既有批次不被默认值覆盖
    expect(persisted).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
    expect(await fakeBrowser.storage.local.get(key)).toEqual({ [key]: existing });
  });
});

describe('discardInactiveTabs（浏览器级快捷键 / 右键菜单路径）', () => {
  it('休眠当前窗口后台标签的安全标签并写台账', async () => {
    await applySettings({ autoDiscardEnabled: true, discardNotifyEnabled: true });
    installTabsApi([
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://b.com/', active: true })
    ]);

    await discardInactiveTabs();

    const [batch] = await autoDiscardRepository.read();
    expect(batch?.tabIds).toEqual([1]);
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auto-discarded', tabIds: [1], count: 1 })
    );
  });

  it('台账写失败时通知不再承诺一键唤醒，也不发送可撤销回执', async () => {
    // Given：标签能真实休眠，但批次台账无法落盘。
    await applySettings({ autoDiscardEnabled: true, discardNotifyEnabled: true });
    installTabsApi([makeTab({ id: 1, url: 'https://a.com/' })]);
    vi.spyOn(autoDiscardRepository, 'write').mockResolvedValueOnce(false);

    // When：执行快捷键休眠。
    await discardInactiveTabs();

    // Then：通知如实说明本次不可一键唤醒，面板收不到虚假的撤销入口。
    expect(fakeBrowser.notifications.create).toHaveBeenCalledWith(
      'tabs-auto-discard',
      expect.objectContaining({ message: t('已休眠 {{count}} 个标签', { count: 1 }) })
    );
    expect(fakeBrowser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auto-discarded' })
    );
  });

  it('无可休眠标签时不写台账（不产生空的「全部唤醒」入口）', async () => {
    await applySettings({ autoDiscardEnabled: true });
    installTabsApi([makeTab({ id: 1, url: 'https://a.com/', active: true })]);

    await discardInactiveTabs();

    expect(await autoDiscardRepository.read()).toEqual([]);
  });

  it('查询异常不逃逸（快捷键回调内的 async 函数）', async () => {
    const api = fakeBrowser.tabs as unknown as { query: () => Promise<never[]> };
    api.query = vi.fn(async () => {
      throw new Error('boom');
    }) as never;

    await expect(discardInactiveTabs()).resolves.toBeUndefined();

    expect(readDiagnostics().some((e) => e.message.includes('休眠后台标签执行失败'))).toBe(true);
  });
});
