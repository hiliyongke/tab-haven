// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { collectSnapshotTabs, restoreSnapshot } from '@/platform/snapshot/snapshots';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';

/**
 * 快照恢复行为规格（PRD FR-D5.1）：
 *  - 加法语义：仅新建缺失标签，已存在的不重复创建、不被关闭；
 *  - 固定/静音状态还原；
 *  - 分组还原：同名组并入、缺失组按名重建（标题/颜色还原）；
 *  - 固定标签不参与分组；快照内重复 URL 去重。
 */

const WINDOW_ID = 1;

/** fake-browser 要求先建窗口：不带有效 windowId 创建的标签会落到 windowId 0。 */
async function ensureWindow(): Promise<void> {
  const win = await fakeBrowser.windows.create();
  expect(win?.id).toBe(WINDOW_ID);
}

function snapTab(partial: Partial<SnapshotTab> & Pick<SnapshotTab, 'url'>): SnapshotTab {
  return { title: '', pinned: false, muted: false, ...partial };
}

function snapshotOf(tabs: SnapshotTab[]): Snapshot {
  return {
    id: 'snap-1',
    name: '测试快照',
    origin: 'manual',
    createdAt: Date.now(),
    windowId: WINDOW_ID,
    tabCount: tabs.length,
    tabs
  };
}

/** fake-browser 对 tabs.group / tabGroups.query 部分实现不全，注入最小实现。 */
function stubTabsApi(): { groupMock: ReturnType<typeof vi.fn>; updateMock: ReturnType<typeof vi.fn> } {
  const groupMock = vi.fn(async (options: { tabIds?: number[]; groupId?: number }) =>
    options.groupId ?? 100 + Math.max(...(options.tabIds ?? [0]))
  );
  const updateMock = vi.fn(async () => undefined);
  const tabs = fakeBrowser.tabs as unknown as { group: typeof groupMock };
  const groups = fakeBrowser.tabGroups as unknown as {
    query: (q: object) => Promise<{ id: number; title?: string }[]>;
    update: typeof updateMock;
  };
  tabs.group = groupMock;
  groups.query = vi.fn(async () => []);
  groups.update = updateMock;
  return { groupMock, updateMock };
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('restoreSnapshot（FR-D5.1 加法恢复）', () => {
  it('仅新建缺失标签：窗口已存在的 URL 不重复创建', async () => {
    stubTabsApi();
    await ensureWindow();
    // 窗口已有 a.com 与 b.com
    await fakeBrowser.tabs.create({ windowId: WINDOW_ID, url: 'https://a.com/' });
    await fakeBrowser.tabs.create({ windowId: WINDOW_ID, url: 'https://b.com/' });

    const snap = snapshotOf([
      snapTab({ url: 'https://a.com/' }), // 已存在 → 跳过
      snapTab({ url: 'https://b.com/' }), // 已存在 → 跳过
      snapTab({ url: 'https://c.com/' }) // 缺失 → 新建
    ]);
    const created = await restoreSnapshot(snap, WINDOW_ID);

    expect(created).toBe(1);
    const all = await fakeBrowser.tabs.query({ windowId: WINDOW_ID });
    expect(all).toHaveLength(3); // 2 个原有 + 1 个新建，无一被关闭
  });

  it('快照内重复 URL 只恢复一次', async () => {
    stubTabsApi();
    await ensureWindow();
    const snap = snapshotOf([
      snapTab({ url: 'https://a.com/' }),
      snapTab({ url: 'https://a.com/' })
    ]);
    const created = await restoreSnapshot(snap, WINDOW_ID);
    expect(created).toBe(1);
  });

  it('全部条目均已存在时为空操作（返回 0）', async () => {
    stubTabsApi();
    await ensureWindow();
    await fakeBrowser.tabs.create({ windowId: WINDOW_ID, url: 'https://a.com/' });
    const snap = snapshotOf([snapTab({ url: 'https://a.com/' })]);
    expect(await restoreSnapshot(snap, WINDOW_ID)).toBe(0);
  });

  it('还原固定与静音状态', async () => {
    stubTabsApi();
    await ensureWindow();
    // fake-browser 不落地 mutedInfo，静音断言以 API 调用为准（spy）
    const updateSpy = vi.spyOn(fakeBrowser.tabs, 'update');
    const snap = snapshotOf([
      snapTab({ url: 'https://a.com/', pinned: true }),
      snapTab({ url: 'https://b.com/', muted: true }),
      snapTab({ url: 'https://c.com/' }) // 未固定未静音：不应有静音调用
    ]);
    await restoreSnapshot(snap, WINDOW_ID);

    const all = await fakeBrowser.tabs.query({ windowId: WINDOW_ID });
    expect(all).toHaveLength(3);
    const pinned = all.find((tab) => tab.url === 'https://a.com/');
    expect(pinned?.pinned).toBe(true);
    // 仅 b.com 被置静音（pinned 内联于 create；c.com 无任何 update）
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.any(Number), { muted: true });
  });

  it('分组还原：缺失组按名重建并写入标题与颜色', async () => {
    const { updateMock } = stubTabsApi();
    await ensureWindow();
    const snap = snapshotOf([
      snapTab({ url: 'https://a.com/', groupTitle: '研究', groupColor: 'blue' }),
      snapTab({ url: 'https://b.com/', groupTitle: '研究', groupColor: 'blue' }),
      snapTab({ url: 'https://c.com/' }) // 无组：保持未分组
    ]);
    await restoreSnapshot(snap, WINDOW_ID);

    // 两个同组标签一次成组，组名/颜色写入
    expect(updateMock).toHaveBeenCalledWith(102, { title: '研究', color: 'blue' });
  });

  it('固定标签不参与分组（Chrome 限制）', async () => {
    const { groupMock } = stubTabsApi();
    await ensureWindow();
    const snap = snapshotOf([
      snapTab({ url: 'https://a.com/', pinned: true, groupTitle: '研究' })
    ]);
    await restoreSnapshot(snap, WINDOW_ID);
    expect(groupMock).not.toHaveBeenCalled();
  });

  it('窗口已有同名组时并入既有组', async () => {
    const { groupMock, updateMock } = stubTabsApi();
    await ensureWindow();
    const groups = fakeBrowser.tabGroups as unknown as {
      query: (q: object) => Promise<{ id: number; title?: string }[]>;
    };
    groups.query = vi.fn(async () => [{ id: 42, title: '研究' }]);

    const snap = snapshotOf([snapTab({ url: 'https://a.com/', groupTitle: '研究' })]);
    await restoreSnapshot(snap, WINDOW_ID);

    expect(groupMock).toHaveBeenCalledWith({ tabIds: [expect.any(Number)], groupId: 42 });
    expect(updateMock).toHaveBeenCalledWith(42, { title: '研究' });
  });
});

describe('collectSnapshotTabs（采集端）', () => {
  it('记录静音与组归属，过滤内部页', () => {
    const tabs: TabRecord[] = [
      {
        id: 1, windowId: 1, index: 0, active: false, pinned: false, incognito: false,
        url: 'https://a.com/', pendingUrl: undefined, title: 'A', favIconUrl: undefined,
        status: 'complete', discarded: false, muted: true, audible: false, groupId: 7,
        splitViewId: undefined, lastAccessed: 1000, autoDiscardable: true
      },
      {
        id: 2, windowId: 1, index: 1, active: false, pinned: false, incognito: false,
        url: 'chrome://newtab', pendingUrl: undefined, title: '内部页', favIconUrl: undefined,
        status: 'complete', discarded: false, muted: false, audible: false, groupId: -1,
        splitViewId: undefined, lastAccessed: 1000, autoDiscardable: true
      }
    ];
    const groups: TabGroupRecord[] = [{ id: 7, title: '研究', color: 'blue', collapsed: false }];
    const collected = collectSnapshotTabs(tabs, groups);
    expect(collected).toHaveLength(1); // 内部页过滤
    expect(collected[0]).toMatchObject({
      url: 'https://a.com/', muted: true, groupTitle: '研究', groupColor: 'blue'
    });
  });
});
