// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';

/**
 * 固定图标切片（`stores/data/pinsSlice.ts`，此前 2.3%）。
 *
 * 这组动作有三处「顺序 / 幂等」契约，错了都会表现为用户可见的怪现象：
 *
 * 1. **「确保固定」而非「翻转」**：`addPin` / `openPin` 都调 `setPinned(tabId, true)`，
 *    因为翻转基准若取过期快照会方向反转（快照说未固定、实际已固定 → 翻成取消固定）。
 * 2. **主动刷新快照**：加/删固定后调 `tabSyncService.requestRefresh()`，否则标签是否
 *    从临时区移入置顶区取决于 `pinned` 事件回灌时序，表现为「切一下 tab 才出现」。
 * 3. **豁免必须早于导航**：`openPin` 新建标签时先 `grantReuseAllowance` 再 `updateTabUrl`，
 *    顺序反了显式打开的固定图标会被复用引擎合并关闭。
 */

const mocks = vi.hoisted(() => ({
  activateTab: vi.fn<(id: number) => Promise<void>>(async () => undefined),
  createNewTab: vi.fn<(windowId: number) => Promise<{ id: number }>>(async () => ({ id: 900 })),
  setPinned: vi.fn<(id: number, pinned: boolean) => Promise<boolean>>(async () => true),
  queryCurrentWindowTabs: vi.fn(async () => [] as TabRecord[]),
  updateTabUrl: vi.fn<(id: number, url: string) => Promise<boolean>>(async () => true),
  grantReuseAllowance: vi.fn<(windowId: number, key: string) => Promise<void>>(
    async () => undefined
  ),
  requestRefresh: vi.fn()
}));

vi.mock('@/platform/tabs', () => ({
  activateTab: mocks.activateTab,
  createNewTab: mocks.createNewTab,
  setPinned: mocks.setPinned,
  queryCurrentWindowTabs: mocks.queryCurrentWindowTabs,
  updateTabUrl: mocks.updateTabUrl
}));

vi.mock('@/platform/reuse/reuseAllowance', () => ({
  grantReuseAllowance: mocks.grantReuseAllowance
}));

vi.mock('@/platform/sync/TabSyncService', () => ({
  tabSyncService: { requestRefresh: mocks.requestRefresh, start: vi.fn(() => () => undefined) }
}));

function tab(partial: Partial<TabRecord> & { id: number }): TabRecord {
  return {
    windowId: 1,
    index: partial.id,
    active: false,
    pinned: false,
    incognito: false,
    groupId: NO_GROUP,
    title: `标签-${partial.id}`,
    url: `https://site${partial.id}.com/`,
    ...partial
  };
}

/** 当前固定图标列表。 */
function pins(): ReturnType<typeof useDataStore.getState>['pins'] {
  return useDataStore.getState().pins;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDataStore.setState({
    folders: [],
    pins: [],
    collapsedSites: [],
    settings: DEFAULT_SETTINGS,
    boundTabIds: [],
    storageDegraded: false,
    ready: true
  });
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('addPin', () => {
  it('无 URL 的标签不固定（不能凭空造出图标）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: undefined }));

    expect(pins()).toHaveLength(0);
    expect(mocks.setPinned).not.toHaveBeenCalled();
  });

  it('非 http(s) 的 URL 被拒绝（chrome:// 等不可固定为常驻图标）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'chrome://settings' }));

    expect(pins()).toHaveLength(0);
    expect(mocks.setPinned).not.toHaveBeenCalled();
  });

  it('固定成功：写入图标 + 用「确保固定」语义置为 Chrome 固定 + 主动刷新快照', async () => {
    await useDataStore.getState().addPin(tab({ id: 5, url: 'https://a.com/', title: 'A' }));

    expect(pins().map((pin) => pin.identity)).toHaveLength(1);
    // 必须是 true（确保）而不是翻转：过期快照会把已固定翻成取消固定
    expect(mocks.setPinned).toHaveBeenCalledWith(5, true);
    // 主动刷新，消除对 pinned 事件回灌时序的依赖
    expect(mocks.requestRefresh).toHaveBeenCalled();
  });

  it('同身份重复固定不产生第二份（按 identity 去重）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    await useDataStore.getState().addPin(tab({ id: 2, url: 'https://a.com/other', title: 'A2' }));

    expect(pins()).toHaveLength(1);
  });

  it('新固定的图标追加在末尾，既有图标相对位置不动（避免整条磁贴条重排跳动）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    await useDataStore.getState().addPin(tab({ id: 2, url: 'https://b.com/', title: 'B' }));
    await useDataStore.getState().addPin(tab({ id: 3, url: 'https://c.com/', title: 'C' }));

    expect(pins().map((pin) => pin.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
      'https://c.com/'
    ]);
  });
});

describe('removePin', () => {
  it('移除图标并取消窗口内同身份标签的固定（「确保取消固定」语义）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    const pin = pins()[0]!;
    mocks.setPinned.mockClear();
    mocks.requestRefresh.mockClear();
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([
      tab({ id: 10, url: 'https://a.com/x', pinned: true }),
      tab({ id: 11, url: 'https://other.com/', pinned: true })
    ]);

    await useDataStore.getState().removePin(pin);

    expect(pins()).toHaveLength(0);
    // 只取消同身份的标签
    expect(mocks.setPinned).toHaveBeenCalledWith(10, false);
    expect(mocks.setPinned).not.toHaveBeenCalledWith(11, false);
    expect(mocks.requestRefresh).toHaveBeenCalled();
  });

  it('窗口内没有同身份标签时只移除图标，不做多余的固定写入', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    const pin = pins()[0]!;
    mocks.setPinned.mockClear();
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([]);

    await useDataStore.getState().removePin(pin);

    expect(pins()).toHaveLength(0);
    expect(mocks.setPinned).not.toHaveBeenCalled();
  });
});

describe('reorderPins', () => {
  async function seedThree(): Promise<void> {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    await useDataStore.getState().addPin(tab({ id: 2, url: 'https://b.com/', title: 'B' }));
    await useDataStore.getState().addPin(tab({ id: 3, url: 'https://c.com/', title: 'C' }));
  }

  it('把图标移到目标之后（C 移到 A 之后）', async () => {
    await seedThree();
    const before = pins();
    const first = before[0]!;
    const last = before[before.length - 1]!;

    await useDataStore.getState().reorderPins(last.id, first.id, true);

    const after = pins();
    expect(after[0]!.id).toBe(first.id);
    expect(after[1]!.id).toBe(last.id);
  });

  it('无变化时不重写（避免多余落盘与镜像调度）', async () => {
    await seedThree();
    const ids = pins().map((pin) => pin.id);

    // 把已在首位的图标放到首位：结果与现状一致
    await useDataStore.getState().reorderPins(ids[0]!, ids[0]!, false);

    expect(pins().map((pin) => pin.id)).toEqual(ids);
  });

  it('目标不存在时不破坏现有顺序', async () => {
    await seedThree();
    const ids = pins().map((pin) => pin.id);

    await useDataStore.getState().reorderPins(ids[0]!, 'nonexistent', true);

    expect(pins().map((pin) => pin.id)).toEqual(ids);
  });
});

describe('openPin', () => {
  it('已有同身份标签：激活并「确保固定」（不新建标签）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    const pin = pins()[0]!;
    mocks.setPinned.mockClear();
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([
      tab({ id: 21, url: 'https://a.com/', active: false, pinned: false }),
      tab({ id: 22, url: 'https://a.com/', active: true, pinned: false })
    ]);

    await useDataStore.getState().openPin(pin);

    // 优先级：激活中的 > 已固定 > id 小
    expect(mocks.activateTab).toHaveBeenCalledWith(22);
    expect(mocks.setPinned).toHaveBeenCalledWith(22, true);
    expect(mocks.createNewTab).not.toHaveBeenCalled();
  });

  it('已固定的标签优先于未固定的（即便未激活）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    const pin = pins()[0]!;
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([
      tab({ id: 31, url: 'https://a.com/', active: false, pinned: true }),
      tab({ id: 30, url: 'https://a.com/', active: false, pinned: false })
    ]);

    await useDataStore.getState().openPin(pin);

    expect(mocks.activateTab).toHaveBeenCalledWith(31);
  });

  it('没有同身份标签：新建标签，且豁免必须早于导航（否则会被复用引擎合并关闭）', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    const pin = pins()[0]!;
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([tab({ id: 40, windowId: 7 })]);

    await useDataStore.getState().openPin(pin);

    expect(mocks.createNewTab).toHaveBeenCalledWith(7);
    expect(mocks.grantReuseAllowance).toHaveBeenCalledWith(7, 'https://a.com/');
    expect(mocks.updateTabUrl).toHaveBeenCalledWith(900, 'https://a.com/');
    expect(mocks.setPinned).toHaveBeenCalledWith(900, true);

    // 顺序断言：豁免先于导航
    const allowanceOrder = mocks.grantReuseAllowance.mock.invocationCallOrder[0]!;
    const navigateOrder = mocks.updateTabUrl.mock.invocationCallOrder[0]!;
    expect(allowanceOrder).toBeLessThan(navigateOrder);
  });

  it('窗口内一个标签都没有（拿不到 windowId）时不做任何操作', async () => {
    await useDataStore.getState().addPin(tab({ id: 1, url: 'https://a.com/', title: 'A' }));
    const pin = pins()[0]!;
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([]);

    await useDataStore.getState().openPin(pin);

    expect(mocks.createNewTab).not.toHaveBeenCalled();
    expect(mocks.activateTab).not.toHaveBeenCalled();
  });
});
