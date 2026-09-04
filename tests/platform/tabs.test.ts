// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import {
  closeTabs,
  computeReorderIndex,
  createNewTab,
  discardTab,
  mapTab,
  moveTab,
  reloadTabs,
  removeGroup,
  updateTabUrl
} from '@/platform/tabs';

/**
 * 平台标签层（30+ 浏览器操作的唯一出口）。
 *
 * 此前零测试。重点覆盖两类契约：
 *  1. **纯计算**的 `computeReorderIndex` —— 拖拽重排写回原生顺序的核心，
 *     算错直接表现为「拖完顺序乱跳」；
 *  2. **返回值语义** —— 本层一律「失败不抛、返回可判定值」，
 *     调用方据此决定要不要留撤销入口，返回值失真即等于静默丢数据。
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

/**
 * 失败项由**注入桩**决定，不依赖 fake-browser 对不存在 id 的处理——
 * 后者对 remove(9999) 静默成功、对 reload 干脆不实现，两种行为都不是 Chrome 的真实语义，
 * 拿它当断言依据等于把测试绑死在模拟器的实现细节上。
 */
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
    tabGroups.get = (async () => {
      throw new Error('group gone');
    }) as unknown as typeof tabGroups.get;

    expect(await removeGroup(99)).toBe('missing');
  });
});

describe('createNewTab', () => {
  it('默认在窗口末尾新建并激活', async () => {
    const created = await createNewTab(1);
    expect(created.active).toBe(true);
  });

  it('after-active 位置：插到当前激活标签之后', async () => {
    // 注入激活标签的查询结果：fake-browser 的 query 对 active 过滤不稳，
    // 而本用例要验证的是「取激活标签 index + 1」这段逻辑。
    // 另外 fake-browser 的 create 会忽略 index，故断言传参而非返回值。
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
