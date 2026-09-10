// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP } from '@/core/tab-types';
import { clearDiagnostics } from '@/platform/diagnostics';
import {
  activateTab,
  activateTabAcrossWindows,
  closeTabs,
  createPlainNewTab,
  createTabsWithUrls,
  detectLanguage,
  discardTab,
  duplicateTab,
  groupTabs,
  moveGroup,
  moveTab,
  moveTabs,
  onTabHighlighted,
  queryAllWindowTabs,
  queryCurrentWindowGroups,
  queryCurrentWindowTabs,
  recolorGroup,
  reloadTabs,
  renameGroup,
  resolveRestoreWindowId,
  setGroupCollapsed,
  setPinned,
  toggleMute,
  togglePinned,
  updateGroupMeta,
  updateTabUrl,
  waitForTabGroupAssignment
} from '@/platform/tabs';

/**
 * `platform/tabs.ts` 的**适配器**部分（纯计算与返回值语义见 tabs.test.ts）。
 *
 * 本层是 30+ 浏览器操作的唯一出口，契约有两条，二者违反都会变成用户可见故障：
 *  1. **失败不抛，返回可判定值** —— 调用方据此决定是否保留撤销入口；
 *  2. **翻转/确保类操作以浏览器实时值为准** —— 调用方传的是渲染快照
 *     （40ms 节流 + 事件回灌延迟），用过期快照翻转会**翻反方向**。
 */

/** chrome.tabs.Tab 的最小可用形状。 */
function rawTab(partial: Record<string, unknown> = {}) {
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

function stubTabGroups(overrides: Record<string, unknown> = {}) {
  Object.assign(fakeBrowser.tabGroups, {
    query: vi.fn(async () => []),
    update: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ id: 1 })),
    ...overrides
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  stubTabGroups();
});

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('查询类', () => {
  it('queryCurrentWindowTabs 按 index 排序返回', async () => {
    Object.assign(fakeBrowser.tabs, {
      query: vi.fn(async () => [
        rawTab({ id: 2, index: 2, url: 'https://b.com/' }),
        rawTab({ id: 1, index: 0, url: 'https://a.com/' })
      ])
    });

    const tabs = await queryCurrentWindowTabs();

    expect(tabs.map((tab) => tab.id)).toEqual([1, 2]);
  });

  it('queryCurrentWindowGroups：无 tabGroups API 时返回空数组（不抛错）', async () => {
    // 注意：不能整体替换 `fakeBrowser.tabGroups` —— `platform/tabs.ts` 在模块加载期就把
    // `browser.tabGroups` 存进了模块级常量，替换对象后被测代码仍指向旧引用。
    // 只能**就地**摘掉 query 方法（函数内部读的是 `browser.tabGroups?.query`，取到实时值）。
    const original = fakeBrowser.tabGroups.query;
    (fakeBrowser.tabGroups as unknown as { query?: unknown }).query = undefined;
    try {
      await expect(queryCurrentWindowGroups()).resolves.toEqual([]);
    } finally {
      (fakeBrowser.tabGroups as unknown as { query?: unknown }).query = original;
    }
  });

  it('queryCurrentWindowGroups：显式 windowId 时不额外查一次标签（高频路径省一次全量）', async () => {
    const tabsQuery = vi.fn(async () => []);
    Object.assign(fakeBrowser.tabs, { query: tabsQuery });
    Object.assign(fakeBrowser.tabGroups, {
      query: vi.fn(async () => [{ id: 3, title: 'G', color: 'blue' }])
    });

    const groups = await queryCurrentWindowGroups(42);

    expect(tabsQuery).not.toHaveBeenCalled();
    expect(groups[0]!.id).toBe(3);
  });

  it('queryCurrentWindowGroups：未给 windowId 时从当前窗口标签推导', async () => {
    Object.assign(fakeBrowser.tabs, { query: vi.fn(async () => [rawTab({ windowId: 9 })]) });
    const groupsQuery = vi.fn(async () => []);
    Object.assign(fakeBrowser.tabGroups, { query: groupsQuery });

    await queryCurrentWindowGroups();

    expect(groupsQuery).toHaveBeenCalledWith({ windowId: 9 });
  });

  it('queryAllWindowTabs 收集跨窗口标签', async () => {
    Object.assign(fakeBrowser.tabs, {
      query: vi.fn(async () => [rawTab({ id: 1 }), rawTab({ id: 2 })])
    });

    await expect(queryAllWindowTabs()).resolves.toHaveLength(2);
  });
});

describe('翻转 / 确保类操作以实时值为准', () => {
  it('toggleMute：实时值优先于过期快照（快照说未静音但实际已静音 → 应取消静音）', async () => {
    const update = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, {
      get: vi.fn(async () => rawTab({ mutedInfo: { muted: true } })),
      update
    });

    await toggleMute(1, false);

    expect(update).toHaveBeenCalledWith(1, { muted: false });
  });

  it('toggleMute：拿不到实时值时回落到快照值', async () => {
    const update = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, {
      get: vi.fn(async () => {
        throw new Error('gone');
      }),
      update
    });

    await toggleMute(1, true);

    expect(update).toHaveBeenCalledWith(1, { muted: false });
  });

  it('togglePinned：实时值优先，失败返回 false（不误报成功）', async () => {
    const update = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, {
      get: vi.fn(async () => rawTab({ pinned: true })),
      update
    });

    await expect(togglePinned(1, false)).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(1, { pinned: false });

    Object.assign(fakeBrowser.tabs, {
      update: vi.fn(async () => {
        throw new Error('cannot pin');
      })
    });
    await expect(togglePinned(1, false)).resolves.toBe(false);
  });

  it('setPinned 是「确保」语义：实时值已一致时不写（避免方向反转）', async () => {
    const update = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, {
      get: vi.fn(async () => rawTab({ pinned: true })),
      update
    });

    await expect(setPinned(1, true)).resolves.toBe(true);

    expect(update).not.toHaveBeenCalled();
  });

  it('setPinned：不一致时写入目标状态', async () => {
    const update = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, {
      get: vi.fn(async () => rawTab({ pinned: false })),
      update
    });

    await expect(setPinned(1, true)).resolves.toBe(true);

    expect(update).toHaveBeenCalledWith(1, { pinned: true });
  });

  it('setPinned：拿不到实时值（标签已关）时按目标状态写一次', async () => {
    // 读不到实时状态时不猜测：直接写目标状态（「确保」语义），写成功即返回 true
    const update = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, {
      get: vi.fn(async () => {
        throw new Error('gone');
      }),
      update
    });

    await expect(setPinned(1, true)).resolves.toBe(true);

    expect(update).toHaveBeenCalledWith(1, { pinned: true });
  });

  it('setPinned：读写都失败时返回 false（不谎报成功）', async () => {
    Object.assign(fakeBrowser.tabs, {
      get: vi.fn(async () => {
        throw new Error('gone');
      }),
      update: vi.fn(async () => {
        throw new Error('gone');
      })
    });

    await expect(setPinned(1, true)).resolves.toBe(false);
  });
});

describe('批量操作的局部失败语义', () => {
  it('closeTabs：只返回真正关闭成功的 id（撤销据此登记，避免重复开标签）', async () => {
    Object.assign(fakeBrowser.tabs, {
      remove: vi.fn(async (id: number) => {
        if (id === 2) throw new Error('no such tab');
      })
    });

    await expect(closeTabs([1, 2, 3])).resolves.toEqual([1, 3]);
  });

  it('reloadTabs：只返回成功唤醒的 id', async () => {
    Object.assign(fakeBrowser.tabs, {
      reload: vi.fn(async (id: number) => {
        if (id === 5) throw new Error('gone');
      })
    });

    await expect(reloadTabs([5, 6])).resolves.toEqual([6]);
  });

  it('moveTabs：空数组直接 false（不发出无意义的浏览器调用）', async () => {
    const move = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, { move });

    await expect(moveTabs([], 0)).resolves.toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it('groupTabs：空数组返回 undefined；失败返回 undefined', async () => {
    const group = vi.fn(async () => 7);
    Object.assign(fakeBrowser.tabs, { group });

    await expect(groupTabs([])).resolves.toBeUndefined();
    expect(group).not.toHaveBeenCalled();

    Object.assign(fakeBrowser.tabs, {
      group: vi.fn(async () => {
        throw new Error('boom');
      })
    });
    await expect(groupTabs([1])).resolves.toBeUndefined();
  });

  it('groupTabs：给了 groupId 走「加入既有组」分支', async () => {
    const group = vi.fn(async () => 7);
    Object.assign(fakeBrowser.tabs, { group });

    await groupTabs([1, 2], 7);

    expect(group).toHaveBeenCalledWith({ tabIds: [1, 2], groupId: 7 });
  });

  it('createTabsWithUrls：单条失败跳过，其余继续，返回成功数', async () => {
    Object.assign(fakeBrowser.tabs, {
      create: vi.fn(async ({ url }: { url: string }) => {
        if (url === 'bad') throw new Error('invalid url');
        return rawTab();
      })
    });
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);

    await expect(createTabsWithUrls(['https://a.com/', 'bad', 'https://b.com/'])).resolves.toBe(2);
  });

  it('createTabsWithUrls：未给 windowId 时回落到当前聚焦窗口', async () => {
    const create = vi.fn<(details?: unknown) => Promise<ReturnType<typeof rawTab>>>(async () =>
      rawTab()
    );
    Object.assign(fakeBrowser.tabs, { create });
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 5 } as never);

    await createTabsWithUrls(['https://a.com/']);

    expect(create.mock.calls[0]![0]).toMatchObject({ windowId: 5 });
  });
});

describe('失败不抛、返回可判定值', () => {
  const failing = async (fn: () => Promise<unknown>) => {
    Object.assign(fakeBrowser.tabs, {
      update: vi.fn(async () => {
        throw new Error('boom');
      }),
      move: vi.fn(async () => {
        throw new Error('boom');
      }),
      discard: vi.fn(async () => {
        throw new Error('boom');
      }),
      duplicate: vi.fn(async () => {
        throw new Error('boom');
      }),
      detectLanguage: vi.fn(async () => {
        throw new Error('boom');
      }),
      create: vi.fn(async () => {
        throw new Error('boom');
      })
    });
    stubTabGroups({
      update: vi.fn(async () => {
        throw new Error('boom');
      }),
      move: vi.fn(async () => {
        throw new Error('boom');
      })
    });
    await expect(fn()).resolves.toBeDefined();
  };

  it('返回值型操作在失败时给出 false/undefined/"und"，而不是抛出', async () => {
    await failing(async () => {
      expect(await moveTab(1, 2)).toBe(false);
      expect(await updateTabUrl(1, 'https://x.com/')).toBe(false);
      expect(await discardTab(1)).toBe(false);
      expect(await duplicateTab(1)).toBe(false);
      expect(await moveGroup(1, 0)).toBe(false);
      expect(await detectLanguage(1)).toBe('und');
      return true;
    });
  });

  it('void 型操作在失败时静默降级（best-effort UI 动作）', async () => {
    await failing(async () => {
      await expect(activateTab(1)).resolves.toBeUndefined();
      await expect(setGroupCollapsed(1, true)).resolves.toBeUndefined();
      await expect(renameGroup(1, 'x')).resolves.toBeUndefined();
      await expect(recolorGroup(1, 'blue')).resolves.toBeUndefined();
      await expect(updateGroupMeta(1, 'x', 'blue')).resolves.toBeUndefined();
      await expect(updateGroupMeta(1, 'x')).resolves.toBeUndefined();
      return true;
    });
  });

  it('activateTabAcrossWindows：聚焦窗口失败仍继续激活标签', async () => {
    const update = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.tabs, { update });
    Object.assign(fakeBrowser.windows, {
      update: vi.fn(async () => {
        throw new Error('window gone');
      })
    });

    await activateTabAcrossWindows({ id: 7, windowId: 3 });

    expect(update).toHaveBeenCalledWith(7, { active: true });
  });

  it('createPlainNewTab 不指定 windowId（浏览器默认在当前窗口打开）', async () => {
    const create = vi.fn(async () => rawTab({ id: 12 }));
    Object.assign(fakeBrowser.tabs, { create });

    const created = await createPlainNewTab();

    expect(create).toHaveBeenCalledWith({});
    expect(created.id).toBe(12);
  });
});

describe('waitForTabGroupAssignment 收敛等待', () => {
  it('成员已入组时立即返回（不空等）', async () => {
    Object.assign(fakeBrowser.tabs, {
      query: vi.fn(async () => [rawTab({ id: 1, groupId: 20 })])
    });

    const started = Date.now();
    await waitForTabGroupAssignment([1], 20, 3, 50);

    expect(Date.now() - started).toBeLessThan(50);
  });

  it('中途已关闭的成员不阻塞收敛（只要求存活成员已入组）', async () => {
    Object.assign(fakeBrowser.tabs, {
      // id 1 已不存在于查询结果中，只剩 id 2 且已入组
      query: vi.fn(async () => [rawTab({ id: 2, groupId: 20 })])
    });

    const started = Date.now();
    await waitForTabGroupAssignment([1, 2], 20, 3, 50);

    expect(Date.now() - started).toBeLessThan(50);
  });

  it('始终未收敛时按上限退出且不抛错（best-effort，由事件驱动兜底）', async () => {
    const query = vi.fn(async () => [rawTab({ id: 1, groupId: NO_GROUP })]);
    Object.assign(fakeBrowser.tabs, { query });

    await expect(waitForTabGroupAssignment([1], 20, 2, 1)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('查询抛错视为未收敛并继续重试', async () => {
    const query = vi.fn(async () => {
      throw new Error('tabs api down');
    });
    Object.assign(fakeBrowser.tabs, { query });

    await expect(waitForTabGroupAssignment([1], 20, 2, 1)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('resolveRestoreWindowId 目标窗口解析', () => {
  it('原窗口仍存在时回到原窗口（不落到当前聚焦窗口）', async () => {
    Object.assign(fakeBrowser.windows, {
      get: vi.fn(async () => ({ id: 3 })),
      getLastFocused: vi.fn(async () => ({ id: 99 }))
    });

    await expect(resolveRestoreWindowId(3)).resolves.toBe(3);
  });

  it('原窗口已关闭时退回落当前聚焦窗口', async () => {
    Object.assign(fakeBrowser.windows, {
      get: vi.fn(async () => {
        throw new Error('window gone');
      }),
      getLastFocused: vi.fn(async () => ({ id: 99 }))
    });

    await expect(resolveRestoreWindowId(3)).resolves.toBe(99);
  });

  it('两个窗口 API 都失败时回落记录值（标签创建失败会进 failed 明细，可重试）', async () => {
    Object.assign(fakeBrowser.windows, {
      get: vi.fn(async () => {
        throw new Error('boom');
      }),
      getLastFocused: vi.fn(async () => {
        throw new Error('boom');
      })
    });

    await expect(resolveRestoreWindowId(3)).resolves.toBe(3);
  });

  it('未给记录值时直接取当前聚焦窗口', async () => {
    Object.assign(fakeBrowser.windows, {
      get: vi.fn(async () => ({ id: 1 })),
      getLastFocused: vi.fn(async () => ({ id: 42 }))
    });

    await expect(resolveRestoreWindowId()).resolves.toBe(42);
  });
});

describe('onTabHighlighted', () => {
  it('把浏览器高亮事件转成 tabIds 并支持注销', () => {
    const seen: (readonly number[])[] = [];
    const addSpy = vi.spyOn(fakeBrowser.tabs.onHighlighted, 'addListener');
    const removeSpy = vi.spyOn(fakeBrowser.tabs.onHighlighted, 'removeListener');

    const off = onTabHighlighted((ids) => seen.push(ids));
    const listener = addSpy.mock.calls.at(-1)?.[0] as unknown as (info: {
      tabIds: number[];
    }) => void;
    listener({ tabIds: [4, 5] });

    expect(seen).toEqual([[4, 5]]);

    off();
    expect(removeSpy).toHaveBeenCalledWith(listener);
  });
});
