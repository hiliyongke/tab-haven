import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { TabSyncService } from '@/platform/sync/TabSyncService';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';

function makeTab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

// fake-browser 未实现 onMoved/onAttached 等事件对象的 addListener/removeListener，
// 这里自建最小事件分发：spy addListener 把回调收集起来，trigger 时一并调用。
// 这样既能驱动 TabSyncService 的 signal，又不受 fake-browser 未实现事件的限制。
function stubEvents(): void {
  const eventNames: Array<['tabs' | 'tabGroups', string]> = [
    ['tabs', 'onCreated'],
    ['tabs', 'onRemoved'],
    ['tabs', 'onUpdated'],
    ['tabs', 'onActivated'],
    ['tabs', 'onMoved'],
    ['tabs', 'onAttached'],
    ['tabs', 'onDetached'],
    ['tabs', 'onReplaced'],
    ['tabGroups', 'onCreated'],
    ['tabGroups', 'onUpdated'],
    ['tabGroups', 'onMoved'],
    ['tabGroups', 'onRemoved']
  ];
  for (const [ns, name] of eventNames) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evt = (fakeBrowser[ns] as any)[name] as {
      addListener: (cb: (...args: unknown[]) => void) => void;
      removeListener: (cb: (...args: unknown[]) => void) => void;
      trigger: (...args: unknown[]) => void;
    };
    const listeners = new Set<(...args: unknown[]) => void>();
    evt.addListener = vi.fn((cb: (...args: unknown[]) => void) => {
      listeners.add(cb);
    });
    evt.removeListener = vi.fn((cb: (...args: unknown[]) => void) => {
      listeners.delete(cb);
    });
    evt.trigger = vi.fn((...args: unknown[]) => {
      for (const cb of [...listeners]) cb(...args);
    });
  }
}


describe('TabSyncService', () => {
  it('监听 tab 事件并刷新快照（实时性）', async () => {
    stubEvents();
    const service = new TabSyncService();
    const snapshots: number[] = [];
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(() => Promise.resolve([makeTab({ id: 1, title: 'A' })]));
    vi.spyOn(fakeBrowser.tabGroups, 'query').mockImplementation(() => Promise.resolve([] as TabGroupRecord[]));

    const stop = service.start((snap) => snapshots.push(snap.generation));
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // 触发一次标签变化
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(() => Promise.resolve([
      makeTab({ id: 1, title: 'A' }),
      makeTab({ id: 2, title: 'B' })
    ]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeBrowser.tabs.onCreated as any).trigger({ id: 2 });
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(2));

    stop();
  });

  it('StrictMode 双启停后仍能刷新（回归：单例 stopped 字段曾卡死首帧）', async () => {
    stubEvents();
    const service = new TabSyncService();
    const snapshotCount = { value: 0 };
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(() => Promise.resolve([makeTab({ id: 1 })]));
    vi.spyOn(fakeBrowser.tabGroups, 'query').mockImplementation(() => Promise.resolve([] as TabGroupRecord[]));

    // 第一次：start → 立即 stop（模拟 StrictMode 的挂载-清理）
    const stop1 = service.start(() => {
      snapshotCount.value += 1;
    });
    stop1();

    // 第二次：真正生效的订阅
    const stop2 = service.start(() => {
      snapshotCount.value += 1;
    });
    await vi.waitFor(() => expect(snapshotCount.value).toBeGreaterThanOrEqual(1));

    // 触发事件，第二次订阅必须仍能刷新（不应被第一次的 stopped 影响）
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(() => Promise.resolve([
      makeTab({ id: 1 }),
      makeTab({ id: 2 })
    ]));
    const before = snapshotCount.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeBrowser.tabs.onCreated as any).trigger({ id: 2 });
    await vi.waitFor(() => expect(snapshotCount.value).toBeGreaterThan(before));

    stop2();
  });

  it('窗口内后续事件被合并而非每次查询（节流）', async () => {
    stubEvents();
    const service = new TabSyncService();
    let queryCalls = 0;
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(async () => {
      queryCalls += 1;
      return [makeTab({ id: 1 })];
    });
    vi.spyOn(fakeBrowser.tabGroups, 'query').mockImplementation(() => Promise.resolve([] as TabGroupRecord[]));

    const stop = service.start(() => {});
    await vi.waitFor(() => expect(queryCalls).toBeGreaterThanOrEqual(1));

    // 连续触发 10 个事件，应在节流窗口内被合并为少量查询（而非 10 次）
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fakeBrowser.tabs.onUpdated as any).trigger({});
    }
    await new Promise((r) => setTimeout(r, 150));
    // 合并生效后，查询次数应远小于事件数：首帧 + trailing 若干，远小于 10
    expect(queryCalls).toBeLessThan(8);

    stop();
  });
});
