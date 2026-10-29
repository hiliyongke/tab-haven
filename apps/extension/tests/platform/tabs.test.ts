// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import {
  closeTabs,
  computeGroupMoveIndex,
  computeNativeGroupMoveIndex,
  computeReorderIndex,
  createNewTab,
  discardTab,
  getTab,
  mapTab,
  moveTab,
  reloadTabs,
  removeGroup,
  updateTabUrl
} from '@/platform/tabs';

/**
 * 平台标签操作行为规格：按标签与分组顺序计算移动位置；浏览器操作失败时返回可判定结果。
 */

function tab(partial: Partial<TabRecord> = {}): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: NO_GROUP,
    ...partial
  };
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('mapTab', () => {
  it('把 Chrome 原生标签映射为领域记录（缺字段有兜底）', () => {
    const mapped = mapTab({
      id: 7,
      windowId: 3,
      index: 2,
      title: 'A',
      url: 'https://a.com/',
      groupId: -1
    } as never);

    expect(mapped.id).toBe(7);
    expect(mapped.windowId).toBe(3);
    expect(mapped.index).toBe(2);
    expect(mapped.title).toBe('A');
    expect(mapped.url).toBe('https://a.com/');
    expect(mapped.groupId).toBe(NO_GROUP);
    // id / windowId 缺失时兜底为 -1（避免 undefined 参与索引运算）
    expect(mapTab({ index: 0, active: false } as never).id).toBe(-1);
  });

  it('splitViewId 只有正整数才算真实分屏（chrome 140+ 未分屏时为 0）', () => {
    expect(mapTab({ id: 1, index: 0, splitViewId: 0 } as never).splitViewId).toBeUndefined();
    expect(mapTab({ id: 1, index: 0, splitViewId: 3 } as never).splitViewId).toBe(3);
  });
});

describe('computeReorderIndex', () => {
  const tabs = [
    tab({ id: 1, index: 0 }),
    tab({ id: 2, index: 1 }),
    tab({ id: 3, index: 2 }),
    tab({ id: 4, index: 3 })
  ];

  it('把 source 放到 target 之前', () => {
    expect(computeReorderIndex({ tabs, sourceId: 4, targetId: 2, placeAfter: false })).toBe(1);
  });

  it('把 source 放到 target 之后', () => {
    // 移除 source(1) 后扁平序为 [2,3,4]，target(2) 位于 0，插其后即 1。
    expect(computeReorderIndex({ tabs, sourceId: 1, targetId: 2, placeAfter: true })).toBe(1);
  });

  it('移动到首位', () => {
    expect(computeReorderIndex({ tabs, sourceId: 3, targetId: 1, placeAfter: false })).toBe(0);
  });

  it('移动到末位', () => {
    expect(computeReorderIndex({ tabs, sourceId: 1, targetId: 4, placeAfter: true })).toBe(3);
  });

  it('target 不存在时返回 -1（调用方据此放弃移动）', () => {
    expect(computeReorderIndex({ tabs, sourceId: 1, targetId: 99, placeAfter: true })).toBe(-1);
  });

  it('source 不存在时返回 -1', () => {
    expect(computeReorderIndex({ tabs, sourceId: 99, targetId: 1, placeAfter: true })).toBe(-1);
  });

  it('index 乱序时先按 index 归一（存储顺序不等于视觉顺序）', () => {
    const shuffled = [tab({ id: 3, index: 2 }), tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 })];
    expect(
      computeReorderIndex({ tabs: shuffled, sourceId: 3, targetId: 1, placeAfter: false })
    ).toBe(0);
  });
});

describe('computeGroupMoveIndex', () => {
  // 三个连续分区：A=[1,2] B=[3,4] C=[5,6]
  const tabs = [
    tab({ id: 1, index: 0 }),
    tab({ id: 2, index: 1 }),
    tab({ id: 3, index: 2 }),
    tab({ id: 4, index: 3 }),
    tab({ id: 5, index: 4 }),
    tab({ id: 6, index: 5 })
  ];
  const A = [1, 2];
  const B = [3, 4];
  const C = [5, 6];

  it('把整组搬到目标分区之后', () => {
    // 剔除 A 后扁平序为 [3,4,5,6]，B 占 0..1，插其后即 2。
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: A, targetTabIds: B, placeAfter: true })
    ).toBe(2);
  });

  it('把整组搬到目标分区之前', () => {
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: C, targetTabIds: B, placeAfter: false })
    ).toBe(2);
  });

  it('搬到首位分区之前落到 0', () => {
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: C, targetTabIds: A, placeAfter: false })
    ).toBe(0);
  });

  it('搬到末位分区之后落到末尾', () => {
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: A, targetTabIds: C, placeAfter: true })
    ).toBe(4);
  });

  it('先剔除 source 整组占位，避免 off-by-N', () => {
    // 移除 source 整组后，以目标组末项在新序列中的位置计算插入索引。
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: A, targetTabIds: B, placeAfter: true })
    ).toBe(2);
  });

  it('目标分区在 index 上不连续时按位置而非 index 定位', () => {
    // X 的标签被其他分区穿插（index 0/2/4），落点应取其在扁平序中的首/末位置。
    const mixed = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1 }),
      tab({ id: 3, index: 2 }),
      tab({ id: 4, index: 3 }),
      tab({ id: 5, index: 4 })
    ];
    const X = [1, 3, 5];
    // 剔除 source(2) 后为 [1,3,4,5]，X 占 0 / 1 / 3 → 首 0、末 3。
    expect(
      computeGroupMoveIndex({ tabs: mixed, sourceTabIds: [2], targetTabIds: X, placeAfter: false })
    ).toBe(0);
    expect(
      computeGroupMoveIndex({ tabs: mixed, sourceTabIds: [2], targetTabIds: X, placeAfter: true })
    ).toBe(4);
  });

  it('目标分区已消失时返回 -1（调用方静默放弃）', () => {
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: A, targetTabIds: [99], placeAfter: true })
    ).toBe(-1);
  });

  it('source 为空时返回 -1', () => {
    expect(
      computeGroupMoveIndex({ tabs, sourceTabIds: [], targetTabIds: B, placeAfter: true })
    ).toBe(-1);
  });
});

describe('computeNativeGroupMoveIndex', () => {
  /**
   * 组顺序由「组的首个标签位置」决定；未分组标签穿插时，标签序号与组序号不等。
   * 这里故意让 10 组占 2 个标签、中间夹一个未分组标签：组序号 1 对应的标签序号是 3。
   */
  const grouped = [
    tab({ id: 1, index: 0, groupId: 10 }),
    tab({ id: 2, index: 1, groupId: 10 }),
    tab({ id: 3, index: 2, groupId: NO_GROUP }),
    tab({ id: 4, index: 3, groupId: 20 }),
    tab({ id: 5, index: 4, groupId: 30 })
  ];

  it('拖到目标组之后返回组序号，而不是标签序号', () => {
    expect(
      computeNativeGroupMoveIndex({
        tabs: grouped,
        sourceGroupId: 10,
        targetGroupId: 20,
        placeAfter: true
      })
    ).toBe(1);
  });

  it('拖到目标组之前返回组序号', () => {
    expect(
      computeNativeGroupMoveIndex({
        tabs: grouped,
        sourceGroupId: 30,
        targetGroupId: 10,
        placeAfter: false
      })
    ).toBe(0);
  });

  it('落到末尾用 -1（接口约定的「放到最后」，不是失败）', () => {
    expect(
      computeNativeGroupMoveIndex({
        tabs: grouped,
        sourceGroupId: 10,
        targetGroupId: 30,
        placeAfter: true
      })
    ).toBe(-1);
  });

  it('目标组已解散返回 undefined：与 -1 区分，调用方才不会静默放弃', () => {
    expect(
      computeNativeGroupMoveIndex({
        tabs: grouped,
        sourceGroupId: 10,
        targetGroupId: 99,
        placeAfter: true
      })
    ).toBeUndefined();
  });
});

/** 为 remove / reload 注入指定标签的失败结果。 */
function stubApi<K extends 'remove' | 'reload'>(api: K, failingId: number): void {
  const tabs = fakeBrowser.tabs as unknown as Record<K, (id: number) => Promise<void>>;
  tabs[api] = vi.fn(async (id: number) => {
    if (id === failingId) throw new Error('tab gone');
  }) as never;
}

describe('返回值语义：失败可判定，不抛不静默', () => {
  it('closeTabs 返回实际关闭的 id（部分失败时只回成功项）', async () => {
    stubApi('remove', 2);
    expect(await closeTabs([1, 2, 3])).toEqual([1, 3]);
  });

  it('reloadTabs 只回成功重载的 id', async () => {
    stubApi('reload', 1);
    expect(await reloadTabs([1, 2])).toEqual([2]);
  });

  it('updateTabUrl 在标签不存在时返回 false', async () => {
    expect(await updateTabUrl(9999, 'https://a.com/')).toBe(false);
  });

  it('moveTab 失败返回 false（拖拽期间标签被关闭属正常竞态）', async () => {
    expect(await moveTab(9999, 0)).toBe(false);
  });

  it('discardTab 失败返回 false（活跃/系统页不可休眠）', async () => {
    expect(await discardTab(9999)).toBe(false);
  });
});

describe('removeGroup', () => {
  it('组已不存在时返回 missing（区分「已解散」与「解散失败」）', async () => {
    const tabGroups = fakeBrowser.tabGroups as unknown as {
      get: (id: number) => Promise<unknown>;
    };
    // 使用 Chrome 返回的错误文案验证「组不存在」的判定。
    tabGroups.get = (async () => {
      throw new Error('No group with id: 99');
    }) as unknown as typeof tabGroups.get;

    expect(await removeGroup(99)).toBe('missing');
  });

  it('组查询失败时返回 failed，与组不存在区分', async () => {
    // 查询失败时保留失败结果，调用方可区别处理查询异常与组不存在。
    const tabGroups = fakeBrowser.tabGroups as unknown as {
      get: (id: number) => Promise<unknown>;
    };
    tabGroups.get = (async () => {
      throw new Error('IPC timeout');
    }) as unknown as typeof tabGroups.get;

    expect(await removeGroup(99)).toBe('failed');
  });
});

describe('createNewTab', () => {
  it('默认在窗口末尾新建并激活', async () => {
    const created = await createNewTab(1);
    expect(created.active).toBe(true);
  });

  it('after-active 位置：插到当前激活标签之后', async () => {
    // 提供当前激活标签索引，并验证新标签接收其后的插入位置。
    const tabs = fakeBrowser.tabs as unknown as { query: (q: unknown) => Promise<unknown[]> };
    tabs.query = vi.fn(async () => [{ id: 5, index: 2 }]) as never;
    const createSpy = vi.spyOn(fakeBrowser.tabs, 'create');

    await createNewTab(1, 'after-active');

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 3, windowId: 1 }));
  });

  it('未指定 windowId 时不传 index（after-active 需窗口上下文）', async () => {
    const created = await createNewTab(undefined, 'after-active');
    expect(created.id).toBeGreaterThanOrEqual(0);
  });
});

describe('getTab', () => {
  it('Given 存在的标签 When 读取 Then 返回映射后的记录', async () => {
    const getSpy = vi
      .spyOn(fakeBrowser.tabs, 'get')
      .mockResolvedValue({ id: 7, windowId: 1, index: 0, url: 'https://a.com/x' } as never);

    const result = await getTab(7);

    expect(getSpy).toHaveBeenCalledWith(7);
    expect(result?.id).toBe(7);
    expect(result?.url).toBe('https://a.com/x');
  });

  it('Given 标签已关闭（读取抛错）When 读取 Then 返回 undefined 而不是抛出', async () => {
    // 契约：尽力而为的读取路径，让调用方不必各写一份 catch。
    const result = await getTab(99999);

    expect(result).toBeUndefined();
  });
});
