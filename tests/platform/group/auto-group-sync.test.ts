// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { disbandAutoGroups, syncAutoGroups } from '@/platform/group/AutoGroupSync';
import type { AutoGroupPlan } from '@/core/group/AutoGrouping';

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

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('AutoGroupSync 生命周期', () => {
  it('创建组成功后在记录中持久化组 id（去重追加）', async () => {
    const groupMock = stubTabsGroup();
    stubTabGroups();

    await syncAutoGroups([PLAN_A]);
    await syncAutoGroups([PLAN_B]);
    // 重复执行同一计划（幂等路径，不应重复记录）
    await syncAutoGroups([PLAN_A]);

    expect(groupMock).toHaveBeenCalledTimes(3);
    const stored = await fakeBrowser.storage.local.get('tabhaven.auto-groups.v1');
    expect(stored['tabhaven.auto-groups.v1']).toEqual([10, 11]);
  });

  it('解散：ungroup 全部成员并清空记录，失败组保留 id 供重试', async () => {
    stubTabsGroup();
    stubTabGroups();
    // removeGroup 的标准做法是 tabs.query({groupId}) + tabs.ungroup（tabGroups 无 remove API），
    // 这里注入对应的最小实现：组 10 的成员 ungroup 失败（模拟异常路径），组 11 正常。
    const ungroupMock = vi.fn(async (tabIds: number[]) => {
      if (tabIds.includes(21)) throw new Error('ungroup failed');
    });
    const queryMock = vi.fn(async (opts: { groupId?: number }) =>
      opts?.groupId === 10 ? [{ id: 21 }, { id: 22 }] : [{ id: 31 }]
    );
    const tabs = fakeBrowser.tabs as unknown as {
      query: typeof queryMock;
      ungroup: typeof ungroupMock;
    };
    tabs.query = queryMock;
    tabs.ungroup = ungroupMock;

    await syncAutoGroups([PLAN_A, PLAN_B]);
    const count = await disbandAutoGroups();

    expect(count).toBe(1); // 只有 11 成功解散（10 的 ungroup 失败）
    expect(ungroupMock).toHaveBeenCalledTimes(2);
    const stored = await fakeBrowser.storage.local.get('tabhaven.auto-groups.v1');
    // 失败组保留 id 供下次重试，避免「组未解散、记录已清」的孤儿组
    expect(stored['tabhaven.auto-groups.v1']).toEqual([10]);
  });

  it('无记录时解散是空操作', async () => {
    const { removeMock } = stubTabGroups();
    const count = await disbandAutoGroups();
    expect(count).toBe(0);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
