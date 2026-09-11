// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { disbandAutoGroups, syncAutoGroups } from '@/platform/group/AutoGroupSync';
import type { AutoGroupPlan } from '@/core/group/AutoGrouping';
import { NO_GROUP } from '@/core/tab-types';

const PLAN_A: AutoGroupPlan = { title: 'github.com', color: 'blue', tabIds: [1, 2] };
const PLAN_B: AutoGroupPlan = { title: 'zh-CN', color: 'cyan', tabIds: [3, 4] };

/**
 * fake-browser 对 tabGroups.create/remove 与部分 update 属性实现不全，
 * 这里在运行时注入最小实现（tabs.ts 的桥接引用同一对象，运行时可达）。
 */
function stubTabGroups(): {
  removeMock: ReturnType<typeof vi.fn>;
  updateMock: ReturnType<typeof vi.fn>;
} {
  const removeMock = vi.fn(async (groupId: number) => {
    if (groupId === 10) throw new Error('group gone');
  });
  const updateMock = vi.fn(async () => undefined);
  const tabGroups = fakeBrowser.tabGroups as unknown as {
    query: (options: object) => Promise<unknown[]>;
    move: (groupId: number, options: object) => Promise<unknown>;
    get: (groupId: number) => Promise<unknown>;
    update: (groupId: number, props: object) => Promise<unknown>;
    remove: (groupId: number) => Promise<void>;
    create: (options: object) => Promise<{ id: number }>;
  };
  // removeGroup 用 tabGroups.get 判定组是否仍存在（区分「已解散」与「解散失败」）。
  // fake-browser 的原生 get 对这里的虚拟组 id 会抛错（被视为组不存在），
  // 因此注入恒成功的 get，让「组存在」成为默认前提。
  tabGroups.get = (async () => ({})) as unknown as typeof tabGroups.get;
  tabGroups.remove = removeMock as unknown as typeof tabGroups.remove;
  tabGroups.update = updateMock as unknown as typeof tabGroups.update;
  return { removeMock, updateMock };
}

function stubTabsGroup(): ReturnType<typeof vi.fn> {
  const groupMock = vi.fn(async (options: { tabIds?: number[] }) =>
    options?.tabIds?.[0] === 1 ? 10 : 11
  );
  const tabs = fakeBrowser.tabs as unknown as { group: typeof groupMock };
  tabs.group = groupMock as unknown as typeof tabs.group;
  return groupMock;
}

/**
 * 注入 tabs.query 的最小实现，区分两种调用形态：
 *  - `{ currentWindow: true }`：执行前的真实状态对齐，返回**仍未分组**的标签；
 *  - `{ groupId }`：removeGroup 查询组成员。
 */
function stubTabsQuery(
  options: {
    /** 仍未分组的标签 id。传函数可在多次调用间变化（模拟状态收敛）。 */
    ungrouped?: readonly number[] | (() => readonly number[]);
    /** groupId → 成员 id 列表（解散路径使用）。 */
    members?: Record<number, readonly number[]>;
  } = {}
): ReturnType<typeof vi.fn> {
  const queryMock = vi.fn(async (opts: { currentWindow?: boolean; groupId?: number }) => {
    if (opts?.groupId !== undefined) {
      return (options.members?.[opts.groupId] ?? []).map((id) => ({ id }));
    }
    const ungrouped =
      typeof options.ungrouped === 'function' ? options.ungrouped() : (options.ungrouped ?? []);
    return ungrouped.map((id) => ({ id, groupId: NO_GROUP }));
  });
  const tabs = fakeBrowser.tabs as unknown as { query: typeof queryMock };
  tabs.query = queryMock as unknown as typeof tabs.query;
  return queryMock;
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('AutoGroupSync 生命周期', () => {
  it('创建组成功后在记录中持久化组 id（去重追加）', async () => {
    const groupMock = stubTabsGroup();
    stubTabGroups();
    stubTabsQuery({ ungrouped: [1, 2, 3, 4] });

    await syncAutoGroups([PLAN_A]);
    await syncAutoGroups([PLAN_B]);
    // 重复执行同一计划（幂等路径，不应重复记录）
    await syncAutoGroups([PLAN_A]);

    expect(groupMock).toHaveBeenCalledTimes(3);
    const stored = await fakeBrowser.storage.local.get('tabs.auto-groups.v1');
    expect(stored['tabs.auto-groups.v1']).toEqual([10, 11]);
  });

  it('解散：ungroup 全部成员并清空记录，失败组保留 id 供重试', async () => {
    stubTabsGroup();
    stubTabGroups();
    // removeGroup 的标准做法是 tabs.query({groupId}) + tabs.ungroup（tabGroups 无 remove API），
    // 这里注入对应的最小实现：组 10 的成员 ungroup 失败（模拟异常路径），组 11 正常。
    const ungroupMock = vi.fn(async (tabIds: number[]) => {
      if (tabIds.includes(21)) throw new Error('ungroup failed');
    });
    const tabs = fakeBrowser.tabs as unknown as { ungroup: typeof ungroupMock };
    tabs.ungroup = ungroupMock as unknown as typeof tabs.ungroup;
    stubTabsQuery({
      ungrouped: [1, 2, 3, 4],
      members: { 10: [21, 22], 11: [31] }
    });

    await syncAutoGroups([PLAN_A, PLAN_B]);
    const count = await disbandAutoGroups();

    expect(count).toBe(1); // 只有 11 成功解散（10 的 ungroup 失败）
    expect(ungroupMock).toHaveBeenCalledTimes(2);
    const stored = await fakeBrowser.storage.local.get('tabs.auto-groups.v1');
    // 失败组保留 id 供下次重试，避免「组未解散、记录已清」的孤儿组
    expect(stored['tabs.auto-groups.v1']).toEqual([10]);
  });

  it('无记录时解散是空操作', async () => {
    const { removeMock } = stubTabGroups();
    const count = await disbandAutoGroups();
    expect(count).toBe(0);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('吸收计划：把标签移入既有组，不新建组、不记录、不改标题', async () => {
    const groupMock = stubTabsGroup();
    const { updateMock } = stubTabGroups();
    stubTabsQuery({ ungrouped: [2] });

    const absorbPlan: AutoGroupPlan = {
      title: 'yehe.woa.com',
      color: 'blue',
      tabIds: [2],
      absorbIntoGroupId: 7
    };
    const count = await syncAutoGroups([absorbPlan]);

    expect(count).toBe(0);
    // 只发生一次 tabs.group 调用，且携带目标组 id（移动语义而非新建）
    expect(groupMock).toHaveBeenCalledTimes(1);
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [2], groupId: 7 });
    // 不新建组（无 updateGroupMeta）、不写入自动组记录（解散范围不变）
    expect(updateMock).not.toHaveBeenCalled();
    const stored = await fakeBrowser.storage.local.get('tabs.auto-groups.v1');
    expect(stored['tabs.auto-groups.v1']).toBeUndefined();
  });

  it('计划过期（标签已入组或已关闭）时不建组：快照滞后不该产生重复组', async () => {
    const groupMock = stubTabsGroup();
    stubTabGroups();
    // 快照派生的计划声称 1、2 未分组，但浏览器真实状态已无未分组标签
    stubTabsQuery({ ungrouped: [] });

    const count = await syncAutoGroups([PLAN_A]);

    expect(count).toBe(0);
    expect(groupMock).not.toHaveBeenCalled();
  });

  it('计划部分过期：只对仍未分组的标签建组', async () => {
    const groupMock = stubTabsGroup();
    stubTabGroups();
    // 标签 1 已入组、标签 2 仍未分组 → 只应把 2 入组
    stubTabsQuery({ ungrouped: [2] });

    await syncAutoGroups([PLAN_A]);

    expect(groupMock).toHaveBeenCalledTimes(1);
    expect(groupMock).toHaveBeenCalledWith({ tabIds: [2] });
  });

  it('并发调用串行执行：后到者按已收敛的真实状态过滤，不重复建组', async () => {
    stubTabGroups();
    const grouped = new Set<number>();
    stubTabsQuery({ ungrouped: () => [1, 2].filter((id) => !grouped.has(id)) });
    // tabs.group 延迟 resolve，制造「上一轮 await 未结束就再次进入」的窗口
    const groupMock = vi.fn(async (options: { tabIds: number[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      for (const id of options.tabIds) grouped.add(id);
      return 10;
    });
    const tabs = fakeBrowser.tabs as unknown as { group: typeof groupMock };
    tabs.group = groupMock as unknown as typeof tabs.group;

    // 模拟响应式路径的连续两次进入（建组本身会触发标签事件）
    const [first, second] = await Promise.all([syncAutoGroups([PLAN_A]), syncAutoGroups([PLAN_A])]);

    expect(groupMock).toHaveBeenCalledTimes(1);
    expect(first + second).toBe(1);
  });
});
