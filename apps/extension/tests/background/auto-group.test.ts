// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import { NO_GROUP } from '@/core/tab-types';
import {
  applyAutoGroupSetting,
  resetAutoGroupSchedulerForTest,
  scheduleAutoGroupReconcile
} from '@/platform/background/autoGroup';

/**
 * background 自动分组引擎（唯一执行者）。
 *
 * 覆盖的四条不变量：
 *  1. 事件驱动的对账把达阈值的同域未分组标签建成原生组；
 *  2. **Chrome 的组继承** —— 从组内标签点开的跨域新标签会被移出自动组，
 *     并在下一轮按自己的域名重新聚合（这是「点链接打开的新网页不归类」的根因）；
 *  3. 开关关闭 / opener 模式不做任何写入；
 *  4. 关闭开关时解散本功能创建的组（记账范围，不碰用户手动组）。
 */

interface FakeTab {
  id: number;
  windowId: number;
  index: number;
  url?: string;
  pendingUrl?: string;
  groupId: number;
  pinned?: boolean;
  active?: boolean;
  incognito?: boolean;
}

interface FakeGroup {
  id: number;
  title?: string;
}

function tab(id: number, url: string, groupId = NO_GROUP): FakeTab {
  return {
    id,
    windowId: 1,
    index: id,
    url,
    groupId,
    pinned: false,
    active: false,
    incognito: false
  };
}

function stubBrowser(state: { tabs: FakeTab[]; groups: FakeGroup[] }) {
  const tabsApi = fakeBrowser.tabs as unknown as Record<string, unknown>;
  const groupsApi = fakeBrowser.tabGroups as unknown as Record<string, unknown>;
  const windowsApi = fakeBrowser.windows as unknown as Record<string, unknown>;

  const windowsGetAll = vi.fn(async () => [{ id: 1 }]);
  windowsApi.getAll = windowsGetAll;

  tabsApi.query = vi.fn(async (options: { windowId?: number }) =>
    state.tabs.filter(
      (item) => options.windowId === undefined || item.windowId === options.windowId
    )
  );
  groupsApi.query = vi.fn(async () => state.groups);
  groupsApi.update = vi.fn(async () => undefined);
  groupsApi.get = vi.fn(async (groupId: number) => {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) throw new Error(`No group with id: ${groupId}`);
    return group;
  });

  let nextGroupId = 100;
  const groupMock = vi.fn(async (options: { tabIds: number[]; groupId?: number }) => {
    const groupId = options.groupId ?? nextGroupId++;
    if (options.groupId === undefined) state.groups.push({ id: groupId, title: '' });
    for (const tabId of options.tabIds) {
      const target = state.tabs.find((item) => item.id === tabId);
      if (target) target.groupId = groupId;
    }
    return groupId;
  });
  tabsApi.group = groupMock;

  const ungroupMock = vi.fn(async (tabIds: number[]) => {
    for (const tabId of tabIds) {
      const target = state.tabs.find((item) => item.id === tabId);
      if (target) target.groupId = NO_GROUP;
    }
  });
  tabsApi.ungroup = ungroupMock;

  return { groupMock, ungroupMock, windowsGetAll };
}

async function setSettings(overrides: Partial<Settings> = {}): Promise<void> {
  await fakeBrowser.storage.local.set({
    'tabs.settings.v1': { ...DEFAULT_SETTINGS, ...overrides }
  });
}

/**
 * 推进调度器并让内部的多级 await 跑完。
 *
 * 引擎一轮内含「读设置 → 查标签/分组/排除集 → 派生 → 写组」多级 Promise，
 * 单次 advanceTimersByTimeAsync 只保证微任务被 flush 一到两层，故重复推进。
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(200);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAutoGroupSchedulerForTest();
});

afterEach(() => {
  vi.useRealTimers();
  resetAutoGroupSchedulerForTest();
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('自动分组引擎（background 事件驱动）', () => {
  it('达阈值的同域未分组标签在事件到来后立即成组', async () => {
    await setSettings({ autoGroupNative: true });
    const state = {
      tabs: [tab(1, 'https://github.com/a'), tab(2, 'https://github.com/b')],
      groups: []
    };
    const { groupMock } = stubBrowser(state);

    scheduleAutoGroupReconcile(1);
    await settle();

    expect(groupMock).toHaveBeenCalledTimes(1);
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [1, 2] });
    // 建组后记账，关闭开关时据此解散
    const stored = await fakeBrowser.storage.local.get('tabs.auto-groups.v1');
    expect(stored['tabs.auto-groups.v1']).toEqual([100]);
  });

  it('Chrome 组继承进来的跨域标签被移出，且同一轮不误建重复组', async () => {
    await setSettings({ autoGroupNative: true });
    await fakeBrowser.storage.local.set({ 'tabs.auto-groups.v1': [7] });
    const state = {
      tabs: [
        tab(1, 'https://github.com/a', 7),
        tab(2, 'https://github.com/b', 7),
        // 从组内标签点链接打开：Chrome 直接塞进同一个组
        tab(3, 'https://notion.so/x', 7)
      ],
      groups: [{ id: 7, title: 'github.com' }]
    };
    const { groupMock, ungroupMock } = stubBrowser(state);

    scheduleAutoGroupReconcile(1);
    await settle();

    expect(ungroupMock).toHaveBeenCalledWith([3]);
    expect(state.tabs[2]!.groupId).toBe(NO_GROUP);
    // notion 只剩 1 个标签，未达默认阈值 2 → 不建新组；github 组保持原样
    expect(groupMock).not.toHaveBeenCalled();
  });

  it('移出后达阈值的站点在补跑的下一轮里成组（一轮内收敛，不等外部事件）', async () => {
    await setSettings({ autoGroupNative: true });
    await fakeBrowser.storage.local.set({ 'tabs.auto-groups.v1': [7] });
    const state = {
      tabs: [
        tab(1, 'https://github.com/a', 7),
        tab(2, 'https://github.com/b', 7),
        // 两个 notion 标签被 Chrome 一起塞进 github 组：移出后应自成一组
        tab(3, 'https://notion.so/x', 7),
        tab(4, 'https://notion.so/y', 7)
      ],
      groups: [{ id: 7, title: 'github.com' }]
    };
    const { groupMock, ungroupMock } = stubBrowser(state);

    scheduleAutoGroupReconcile(1);
    await settle();

    expect(ungroupMock).toHaveBeenCalledWith([3, 4]);
    // 补跑的那一轮把 notion 建成新组（新组 id 从 100 起）
    expect(groupMock).toHaveBeenCalledTimes(1);
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [3, 4] });
  });

  it('开关关闭时不做任何分组写入', async () => {
    await setSettings({ autoGroupNative: false });
    const state = {
      tabs: [tab(1, 'https://github.com/a'), tab(2, 'https://github.com/b')],
      groups: []
    };
    const { groupMock } = stubBrowser(state);

    scheduleAutoGroupReconcile(1);
    await settle();

    expect(groupMock).not.toHaveBeenCalled();
  });

  it('opener（来源树）模式不产出原生组', async () => {
    await setSettings({ autoGroupNative: true, groupMode: 'opener' });
    const state = {
      tabs: [tab(1, 'https://github.com/a'), tab(2, 'https://github.com/b')],
      groups: []
    };
    const { groupMock } = stubBrowser(state);

    scheduleAutoGroupReconcile(1);
    await settle();

    expect(groupMock).not.toHaveBeenCalled();
  });

  it('关闭开关时解散本功能创建的组并清空记账', async () => {
    await setSettings({ autoGroupNative: false });
    await fakeBrowser.storage.local.set({ 'tabs.auto-groups.v1': [7] });
    const state = {
      tabs: [tab(1, 'https://github.com/a', 7), tab(2, 'https://github.com/b', 7)],
      groups: [{ id: 7, title: 'github.com' }]
    };
    const { ungroupMock } = stubBrowser(state);

    applyAutoGroupSetting({ autoGroupNative: false, groupMode: 'site', aggregationThreshold: 2 });
    await settle();

    expect(ungroupMock).toHaveBeenCalledWith([1, 2]);
    const stored = await fakeBrowser.storage.local.get('tabs.auto-groups.v1');
    expect(stored['tabs.auto-groups.v1']).toEqual([]);
  });

  it('相同聚合设置重复应用不重复对账（签名去重）', async () => {
    await setSettings({ autoGroupNative: true });
    const state = { tabs: [], groups: [] };
    const { windowsGetAll } = stubBrowser(state);
    const settings = { autoGroupNative: true, groupMode: 'site' as const, aggregationThreshold: 2 };

    applyAutoGroupSetting(settings);
    await settle();
    const firstCalls = windowsGetAll.mock.calls.length;

    applyAutoGroupSetting({ ...settings });
    await settle();

    expect(windowsGetAll.mock.calls.length).toBe(firstCalls);
  });

  it('阈值变化会触发重新对账（纯参数变更也要补组）', async () => {
    await setSettings({ autoGroupNative: true });
    const state = { tabs: [tab(1, 'https://github.com/a')], groups: [] };
    const { groupMock, windowsGetAll } = stubBrowser(state);

    applyAutoGroupSetting({ autoGroupNative: true, groupMode: 'site', aggregationThreshold: 2 });
    await settle();
    expect(groupMock).not.toHaveBeenCalled();

    // 真实链路上 settings watch 回调时存储已是新值；对账读的是存储，这里同步落盘。
    await setSettings({ autoGroupNative: true, aggregationThreshold: 1 });
    applyAutoGroupSetting({ autoGroupNative: true, groupMode: 'site', aggregationThreshold: 1 });
    await settle();

    expect(windowsGetAll.mock.calls.length).toBeGreaterThan(1);
    // 阈值降到 1：单标签站点也成组
    expect(groupMock).toHaveBeenCalledTimes(1);
  });
});
