import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import {
  getLastActiveTabId,
  handleWindowRemoved,
  initWindowTabsCache,
  markSkipAutoSave,
  recordActiveTab,
  refreshWindowTabs,
  scheduleWindowRefresh
} from '@/entrypoints/background/windowCache';

/**
 * 窗口标签缓存与关窗自动快照 —— **本文件是「关窗快照」这条兜底链路的唯一回归保护**。
 *
 * `windowCache.ts` 是关闭窗口时快照内容的唯一数据来源。一旦 SW 重水化或缓存写入
 * 逻辑回归，快照会**静默丢失**且 UI 毫无征兆。这里锁住四类不变量：
 *
 *  1. 采集口径：只收 http(s)，`chrome://` 等内部页不得进快照（收了就是死条目）；
 *  2. 写入闸门：开关关闭 / 无缓存 / 已留档（skip 标记）三条路径都不得写快照；
 *  3. skip 标记语义：一次性消费、仅作用于该窗口、超 TTL 自动失效；
 *  4. 生命周期：窗口关闭后清理激活锚点、在途刷新不得复活幽灵键、防抖合并查询。
 *
 * ## 两个必须绕开的测试环境陷阱（踩过，勿重蹈）
 *
 * **① fake-browser 的 `windows.create()` 恒返回 id=1**，拿不到互不相同的窗口 id。
 * 而 `windowCache` 有模块级状态（`memWindowTabs` / `removedWindowIds` /
 * `lastActiveTabIds` / 各类定时器），`fakeBrowser.reset()` **不会**清它。若多个用例
 * 共用 id=1，前一个用例的 `handleWindowRemoved(1)` 会让后一个用例的
 * `refreshWindowTabs(1)` 提前 return —— 于是「不写快照」类断言**因为什么都没发生
 * 而通过**，形成假绿。因此本文件一律使用**互不相同的合成窗口 id**，并把
 * `tabs.query` 直接 mock 掉，不依赖真实窗口。
 *
 * **② fake-browser 的 `tabGroups.query` 是同步抛错**（不是 rejected promise），
 * 采集端的 `.catch(() => [])` 兜不住，会一路冒泡成「静默不落盘」，必须注入实现。
 *
 * 写入闸门类用例走 `storage.session` 预置缓存：这正是 SW 被回收后 `handleWindowRemoved`
 * 的兜底读取路径（`memWindowTabs` 为空 → 回读 session），比依赖内存态更贴近真实场景。
 */

const WINDOW_TABS_KEY = 'tabs.window-tabs.v1';

/** fake-browser 未实现 tabGroups.query（同步抛错），注入最小实现。 */
function stubTabGroupsQuery(): void {
  const tabGroups = fakeBrowser.tabGroups as unknown as { query: () => Promise<never[]> };
  tabGroups.query = vi.fn(async () => [] as never[]);
}

/** chrome.tabs.Tab 的最小可用形状（mapTab 会直接读 index/active/pinned/incognito）。 */
function rawTab(partial: {
  id: number;
  windowId: number;
  url?: string;
  index?: number;
  active?: boolean;
  title?: string;
}): Record<string, unknown> {
  return {
    id: partial.id,
    windowId: partial.windowId,
    url: partial.url,
    title: partial.title ?? '',
    index: partial.index ?? 0,
    active: partial.active ?? false,
    pinned: false,
    incognito: false,
    groupId: -1
  };
}

/** 把 `tabs.query` 固定为给定结果（不依赖真实窗口，可用任意合成 windowId）。 */
function mockTabsQuery(windowId: number, tabs: Record<string, unknown>[]): void {
  const api = fakeBrowser.tabs as unknown as { query: (q: unknown) => Promise<unknown[]> };
  api.query = vi.fn(async (q: { windowId?: number }) =>
    q?.windowId === windowId ? tabs : []
  ) as never;
}

/** 在 `storage.session` 预置某窗口的标签缓存（模拟 SW 回收后仅剩 session 的场景）。 */
async function seedSessionCache(
  windowId: number,
  tabs: { url: string; title?: string }[]
): Promise<void> {
  const rec = await fakeBrowser.storage.session.get(WINDOW_TABS_KEY);
  const cache = (rec[WINDOW_TABS_KEY] as Record<string, unknown> | undefined) ?? {};
  cache[String(windowId)] = tabs.map((tab) => ({
    url: tab.url,
    title: tab.title ?? '',
    pinned: false,
    muted: false
  }));
  await fakeBrowser.storage.session.set({ [WINDOW_TABS_KEY]: cache });
}

async function readSessionCache(): Promise<Record<string, unknown[]>> {
  const rec = await fakeBrowser.storage.session.get(WINDOW_TABS_KEY);
  return (rec[WINDOW_TABS_KEY] as Record<string, unknown[]> | undefined) ?? {};
}

beforeEach(() => {
  vi.useFakeTimers();
  stubTabGroupsQuery();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('refreshWindowTabs 采集口径', () => {
  it('只收录 http(s)：内部页与无 URL 的标签不进缓存（收了就是无法恢复的死条目）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const windowId = 1001;
    mockTabsQuery(windowId, [
      rawTab({ id: 1, windowId, url: 'https://a.com/', title: 'A' }),
      rawTab({ id: 2, windowId, url: 'http://b.com/', title: 'B' }),
      rawTab({ id: 3, windowId, url: 'chrome://settings' }),
      rawTab({ id: 4, windowId, url: 'about:blank' }),
      rawTab({ id: 5, windowId })
    ]);

    await refreshWindowTabs(windowId);
    await handleWindowRemoved(windowId);

    const all = await snapshotsRepository.read();
    expect(all).toHaveLength(1);
    expect(all[0]!.tabs.map((tab) => tab.url)).toEqual(['https://a.com/', 'http://b.com/']);
  });

  it('刷新时补种冷启动的激活锚点（SW 回收后 lastActiveTabIds 为空）', async () => {
    const windowId = 1002;
    mockTabsQuery(windowId, [
      rawTab({ id: 11, windowId, url: 'https://a.com/', active: false }),
      rawTab({ id: 12, windowId, url: 'https://b.com/', active: true })
    ]);

    await refreshWindowTabs(windowId);

    // 锚点缺失时用「当前激活标签」补种，供「新建标签位置 = 激活标签之后」使用
    expect(getLastActiveTabId(windowId)).toBe(12);
  });

  it('在途刷新期间窗口被关闭时丢弃结果（不复活幽灵键）', async () => {
    const windowId = 1003;
    let releaseQuery: ((tabs: unknown[]) => void) | undefined;
    const inFlight = new Promise<unknown[]>((resolve) => {
      releaseQuery = resolve;
    });
    const api = fakeBrowser.tabs as unknown as { query: (q: unknown) => Promise<unknown[]> };
    api.query = vi.fn(() => inFlight) as never;

    const refreshing = refreshWindowTabs(windowId);
    // 查询尚未返回时窗口关闭：标记该窗口已移除
    await handleWindowRemoved(windowId);

    releaseQuery?.([rawTab({ id: 21, windowId, url: 'https://late.com/', active: true })]);
    await refreshing;

    const cache = await readSessionCache();
    expect(cache[String(windowId)]).toBeUndefined();
  });
});

describe('handleWindowRemoved 写入闸门', () => {
  it('开关开启：把缓存内容写成一份 auto 快照', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const windowId = 2001;
    await seedSessionCache(windowId, [
      { url: 'https://a.com/', title: 'A' },
      { url: 'https://b.com/', title: 'B' }
    ]);

    await handleWindowRemoved(windowId);

    const all = await snapshotsRepository.read();
    expect(all).toHaveLength(1);
    expect(all[0]!.origin).toBe('auto');
    expect(all[0]!.tabCount).toBe(2);
    expect(all[0]!.name.length).toBeGreaterThan(0);
  });

  it('开关关闭：完全不写（默认关闭语义，自动化不得接管用户数据）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: false });
    const windowId = 2002;
    await seedSessionCache(windowId, [{ url: 'https://a.com/' }]);
    const writeSpy = vi.spyOn(snapshotsRepository, 'write');

    await handleWindowRemoved(windowId);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(await snapshotsRepository.read()).toHaveLength(0);
  });

  it('无缓存（该窗口从未被刷新过）：不写空快照', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const writeSpy = vi.spyOn(snapshotsRepository, 'write');
    // 先确认 storage 中没有该窗口的缓存，避免断言因「恰好没有数据」而假绿
    expect((await readSessionCache())['2003']).toBeUndefined();

    await handleWindowRemoved(2003);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(await snapshotsRepository.read()).toHaveLength(0);
  });

  it('清理激活锚点（窗口已关闭，锚点不得残留）', async () => {
    const windowId = 2004;
    recordActiveTab(windowId, 42);
    expect(getLastActiveTabId(windowId)).toBe(42);

    await handleWindowRemoved(windowId);

    expect(getLastActiveTabId(windowId)).toBeUndefined();
  });

  it('写盘失败只告警，不让异常逃逸成未捕获 rejection', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const windowId = 2005;
    await seedSessionCache(windowId, [{ url: 'https://a.com/' }]);
    vi.spyOn(snapshotsRepository, 'write').mockResolvedValue(false);

    await expect(handleWindowRemoved(windowId)).resolves.toBeUndefined();
    expect(readDiagnostics().some((entry) => entry.message.includes('关窗自动快照写入失败'))).toBe(
      true
    );
  });

  it('写盘成功后缓存条目从 session 清除（窗口已不存在，不驻留到浏览器重启）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const windowId = 2006;
    await seedSessionCache(windowId, [{ url: 'https://a.com/' }]);

    await handleWindowRemoved(windowId);

    expect((await readSessionCache())[String(windowId)]).toBeUndefined();
  });
});

describe('skip-auto-save 标记（归档已自行留档，防重复快照）', () => {
  it('标记存在时跳过本次自动保存（同一预置内容，无标记时本会写入 —— 见上组用例）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const windowId = 3001;
    await seedSessionCache(windowId, [{ url: 'https://a.com/' }]);
    await markSkipAutoSave(windowId);

    await handleWindowRemoved(windowId);

    expect(await snapshotsRepository.read()).toHaveLength(0);
  });

  it('标记仅作用于该窗口，不影响其他窗口正常保存', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const skipWindow = 3002;
    const normalWindow = 3003;
    await seedSessionCache(skipWindow, [{ url: 'https://skip.com/' }]);
    await seedSessionCache(normalWindow, [{ url: 'https://save.com/' }]);
    await markSkipAutoSave(skipWindow);

    await handleWindowRemoved(skipWindow);
    await handleWindowRemoved(normalWindow);

    const all = await snapshotsRepository.read();
    expect(all).toHaveLength(1);
    expect(all[0]!.tabs[0]!.url).toBe('https://save.com/');
  });

  it('标记是一次性的：消费后即从 session 镜像中清除', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const windowId = 3004;
    await seedSessionCache(windowId, [{ url: 'https://a.com/' }]);
    await markSkipAutoSave(windowId);
    const before = await fakeBrowser.storage.session.get('tabs.skip-auto-save-once');
    expect(
      (before['tabs.skip-auto-save-once'] as { id: number }[]).some((m) => m.id === windowId)
    ).toBe(true);

    await handleWindowRemoved(windowId);

    const after = await fakeBrowser.storage.session.get('tabs.skip-auto-save-once');
    const markers = (after['tabs.skip-auto-save-once'] as { id: number }[] | undefined) ?? [];
    expect(markers.some((marker) => marker.id === windowId)).toBe(false);
  });

  it('超过 TTL（30s）的标记视为作废，关窗仍正常保存', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    const windowId = 3005;
    await seedSessionCache(windowId, [{ url: 'https://a.com/' }]);
    await markSkipAutoSave(windowId);

    // 「标记已发放但窗口没随之关闭，30s 后才真正关闭」不得吃掉一次正当的自动保存
    vi.setSystemTime(Date.now() + 31_000);
    await handleWindowRemoved(windowId);

    expect(await snapshotsRepository.read()).toHaveLength(1);
  });
});

describe('scheduleWindowRefresh 防抖', () => {
  it('同一窗口的连续刷新请求合并为一次查询', async () => {
    const windowId = 4001;
    mockTabsQuery(windowId, [rawTab({ id: 31, windowId, url: 'https://a.com/', active: true })]);
    const querySpy = vi.spyOn(fakeBrowser.tabs, 'query');
    querySpy.mockClear();

    scheduleWindowRefresh(windowId);
    scheduleWindowRefresh(windowId);
    scheduleWindowRefresh(windowId);
    // 防抖窗口内不得发起任何查询
    expect(querySpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(querySpy).toHaveBeenCalledTimes(1);
  });
});

describe('initWindowTabsCache 重水化', () => {
  it('session 缓存损坏时丢弃并留痕，不抛错（脏数据不得连累关窗快照整体失败）', async () => {
    await fakeBrowser.storage.session.set({ [WINDOW_TABS_KEY]: { bad: 'shape' } });
    const windows = fakeBrowser.windows as unknown as { getAll: () => Promise<unknown[]> };
    windows.getAll = vi.fn(async () => []) as never;

    await expect(initWindowTabsCache()).resolves.toBeUndefined();

    expect(
      readDiagnostics().some((entry) => entry.message.includes('session 窗口缓存数据损坏'))
    ).toBe(true);
  });
});
