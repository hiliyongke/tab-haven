// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { createFolderItem } from '@/core/fixed/FolderOps';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { foldersRepository } from '@/platform/storage/repositories';
import { readSession, updateSession } from '@/platform/storage/session';

/**
 * 固定空间切片中此前未被覆盖的动作（`stores/data/folderSlice.ts`，此前 36%）。
 *
 * 重点覆盖三类「错了会丢数据或拆散用户结构」的契约：
 *
 * 1. **`openSavedItem` 的优先级链**：挂起标签 → 已绑定标签 → 精确 URL 匹配 → 新建绑定。
 *    精确匹配还必须排除「已绑定给其他条目」的标签，否则一个标签同时服务两个条目，
 *    违反「一个 tab 只服务一个条目」的不变量。
 * 2. **`syncFolderToNativeGroup` 的排除集**：`tabs.group` 是**移动语义**，
 *    把已属于其他原生组、隐身或已固定的标签拉进来会拆散用户手动建立的组。
 * 3. **`createFolderFromNativeGroup` 的导入守卫**：导入事务期间写 folders 会被丢弃，
 *    但绑定变更照常发生 → 留下指向不存在条目的脏绑定，整条路径必须跳过。
 */

const mocks = vi.hoisted(() => ({
  activateTab: vi.fn<(id: number) => Promise<void>>(async () => undefined),
  createNewTab: vi.fn<(windowId: number) => Promise<{ id: number }>>(async () => ({ id: 900 })),
  updateTabUrl: vi.fn<(id: number, url: string) => Promise<boolean>>(async () => true),
  queryCurrentWindowTabs: vi.fn<() => Promise<TabRecord[]>>(async () => []),
  groupTabs: vi.fn<(ids: readonly number[]) => Promise<number | undefined>>(async () => 500),
  updateGroupMeta: vi.fn<(id: number, title: string) => Promise<void>>(async () => undefined),
  waitForTabGroupAssignment: vi.fn<(ids: readonly number[], groupId: number) => Promise<void>>(
    async () => undefined
  ),
  grantReuseAllowance: vi.fn<(windowId: number, url: string) => Promise<void>>(
    async () => undefined
  ),
  requestRefresh: vi.fn()
}));

vi.mock('@/platform/tabs', () => ({
  activateTab: mocks.activateTab,
  createNewTab: mocks.createNewTab,
  updateTabUrl: mocks.updateTabUrl,
  queryCurrentWindowTabs: mocks.queryCurrentWindowTabs,
  groupTabs: mocks.groupTabs,
  updateGroupMeta: mocks.updateGroupMeta,
  waitForTabGroupAssignment: mocks.waitForTabGroupAssignment,
  setPinned: vi.fn(async () => true),
  discardTab: vi.fn(async () => true),
  duplicateTab: vi.fn(async () => true),
  moveGroup: vi.fn(async () => true),
  recolorGroup: vi.fn(async () => undefined),
  renameGroup: vi.fn(async () => undefined),
  setGroupCollapsed: vi.fn(async () => undefined),
  toggleMute: vi.fn(async () => undefined),
  togglePinned: vi.fn(async () => true)
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

function folders() {
  return useDataStore.getState().folders;
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
    importing: false,
    ready: true
  });
});

afterEach(() => {
  fakeBrowser.reset();
});

async function seedFolder(
  name: string,
  items: { url: string; title?: string }[]
): Promise<{ folderId: string; itemIds: string[] }> {
  await useDataStore.getState().createFolder(name);
  // createFolder 追加到末尾：按 id 就地替换刚建的那个，**不能整体重设 folders**，
  // 否则连续 seed 多个文件夹时前面的会被抹掉（本文件多个用例依赖多文件夹共存）。
  const createdFolder = folders().at(-1)!;
  const created = items.map((item) =>
    createFolderItem({ url: item.url, title: item.title ?? 'T' })
  );
  useDataStore.setState({
    folders: folders().map((folder) =>
      folder.id === createdFolder.id ? { ...folder, items: created } : folder
    )
  });
  return { folderId: createdFolder.id, itemIds: created.map((item) => item.id) };
}

describe('removeFolderItem', () => {
  it('移除条目、清掉其会话绑定，并主动刷新快照', async () => {
    const { folderId, itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    await updateSession({ itemTabBindings: { [itemIds[0]!]: 77 } });
    mocks.requestRefresh.mockClear();

    await useDataStore.getState().removeFolderItem(folderId, itemIds[0]!);

    expect(folders()[0]!.items).toHaveLength(0);
    expect(await readSession()).toMatchObject({ itemTabBindings: {} });
    expect(useDataStore.getState().boundTabIds).toEqual([]);
    // 被释放的标签可能带原生组/固定状态，UI 需按最新状态重新归类
    expect(mocks.requestRefresh).toHaveBeenCalled();
  });

  it('只移除目标文件夹里的目标条目（同名条目在别的文件夹不受影响）', async () => {
    const a = await seedFolder('A', [{ url: 'https://a.com/' }]);
    await seedFolder('B', [{ url: 'https://b.com/' }]);

    await useDataStore.getState().removeFolderItem(a.folderId, a.itemIds[0]!);

    expect(folders().find((folder) => folder.name === 'A')!.items).toHaveLength(0);
    expect(folders().find((folder) => folder.name === 'B')!.items).toHaveLength(1);
  });
});

describe('列表与文件夹排序', () => {
  it('reorderFolderItems 调整条目顺序', async () => {
    const { folderId, itemIds } = await seedFolder('工作', [
      { url: 'https://a.com/' },
      { url: 'https://b.com/' },
      { url: 'https://c.com/' }
    ]);

    await useDataStore.getState().reorderFolderItems({
      folderId,
      sourceId: itemIds[0]!,
      targetId: itemIds[2]!,
      placeAfter: true
    });

    expect(folders()[0]!.items.map((item) => item.url)).toEqual([
      'https://b.com/',
      'https://c.com/',
      'https://a.com/'
    ]);
  });

  it('moveFolder 调整文件夹顺序', async () => {
    await seedFolder('A', [{ url: 'https://a.com/' }]);
    await seedFolder('B', [{ url: 'https://b.com/' }]);
    await seedFolder('C', [{ url: 'https://c.com/' }]);
    const [a, , c] = folders();

    await useDataStore.getState().moveFolder(a!.id, c!.id, true);

    expect(folders().map((folder) => folder.name)).toEqual(['B', 'C', 'A']);
  });

  it('moveFolderItem 把条目移到另一个文件夹', async () => {
    const source = await seedFolder('源', [{ url: 'https://a.com/' }]);
    const target = await seedFolder('目标', [{ url: 'https://b.com/' }]);

    await useDataStore
      .getState()
      .moveFolderItem(source.folderId, source.itemIds[0]!, target.folderId);

    expect(folders().find((f) => f.name === '源')!.items).toHaveLength(0);
    // 目标文件夹保留自己的条目，被移入的追加在末尾
    expect(
      folders()
        .find((f) => f.name === '目标')!
        .items.map((i) => i.url)
    ).toEqual(['https://b.com/', 'https://a.com/']);
  });
});

describe('openSavedItem 优先级链', () => {
  it('挂起条目的待导航标签优先（url 尚未转正，避免误匹配/重复新建）', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([
      tab({ id: 5, url: 'about:blank' }),
      tab({ id: 6, url: 'https://a.com/', pendingUrl: 'https://a.com/' })
    ]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/',
      pendingTabId: 6
    });

    expect(mocks.activateTab).toHaveBeenCalledWith(6);
    expect(mocks.createNewTab).not.toHaveBeenCalled();
  });

  it('挂起标签已消失时不激活（继续走后面的分支）', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/',
      pendingTabId: 999
    });

    expect(mocks.activateTab).not.toHaveBeenCalled();
  });

  it('已绑定标签优先于 URL 匹配', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    await updateSession({ itemTabBindings: { [itemIds[0]!]: 42 } });
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([
      tab({ id: 42, url: 'https://a.com/' }),
      tab({ id: 43, url: 'https://a.com/' })
    ]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/'
    });

    expect(mocks.activateTab).toHaveBeenCalledWith(42);
  });

  it('精确 URL 匹配时建立绑定（新建绑定写入会话）', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([tab({ id: 8, url: 'https://a.com/' })]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/'
    });

    expect(mocks.activateTab).toHaveBeenCalledWith(8);
    expect((await readSession()).itemTabBindings[itemIds[0]!]).toBe(8);
  });

  it('排除「已绑定给其他条目」的标签（一个标签只服务一个条目）', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    await updateSession({ itemTabBindings: { 'other-item': 8 } });
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([tab({ id: 8, url: 'https://a.com/' })]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/'
    });

    // 不得占用已属于别的条目的标签
    expect(mocks.activateTab).not.toHaveBeenCalledWith(8);
  });

  it('排除隐身标签（隐身窗口的标签不应被计入普通条目）', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([
      tab({ id: 9, url: 'https://a.com/', incognito: true })
    ]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/'
    });

    expect(mocks.activateTab).not.toHaveBeenCalledWith(9);
  });

  it('无匹配时新建标签，豁免早于导航，并写入绑定', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([tab({ id: 1, windowId: 11 })]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/'
    });

    expect(mocks.createNewTab).toHaveBeenCalledWith(11);
    expect(mocks.updateTabUrl).toHaveBeenCalledWith(900, 'https://a.com/');
    const allowanceOrder = mocks.grantReuseAllowance.mock.invocationCallOrder[0]!;
    const navigateOrder = mocks.updateTabUrl.mock.invocationCallOrder[0]!;
    expect(allowanceOrder).toBeLessThan(navigateOrder);
    expect((await readSession()).itemTabBindings[itemIds[0]!]).toBe(900);
  });

  it('没有任何标签（拿不到 windowId）时不新建', async () => {
    const { itemIds } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    mocks.queryCurrentWindowTabs.mockResolvedValueOnce([]);

    await useDataStore.getState().openSavedItem({
      id: itemIds[0]!,
      url: 'https://a.com/'
    });

    expect(mocks.createNewTab).not.toHaveBeenCalled();
  });
});

describe('createFolderFromNativeGroup', () => {
  it('导入事务进行中整条路径跳过（否则留下指向不存在条目的脏绑定）', async () => {
    // 注意：`ctx.isImporting()` 读的是模块级闭包，**不是 store 状态**，
    // 所以 `setState({ importing: true })` 骗不过它 —— 必须走真实并发路径。
    // 做法：用导出结果构造合法备份，把 folders.write 换成可控 promise 挂在半途，
    // 等到确认导入已进入写入阶段再调用受守卫的动作（用 waitFor 消除时序猜测）。
    const payload = await useDataStore.getState().exportData();
    let release: (() => void) | undefined;
    const writeSpy = vi
      .spyOn(foldersRepository, 'write')
      .mockImplementation(() => new Promise<boolean>((resolve) => (release = () => resolve(true))));

    const importing = useDataStore.getState().importData(payload);
    await vi.waitFor(() => expect(writeSpy).toHaveBeenCalled());

    const ok = await useDataStore
      .getState()
      .createFolderFromNativeGroup('组', [tab({ id: 1, url: 'https://a.com/' })]);

    expect(ok).toBe(false);
    expect(folders()).toHaveLength(0);

    release?.();
    await importing.catch(() => undefined);
  });

  it('组内全是不可收藏的内部页时不建空文件夹（否则凭空多一个空夹还提示已保存）', async () => {
    const ok = await useDataStore
      .getState()
      .createFolderFromNativeGroup('组', [
        tab({ id: 1, url: 'chrome://settings' }),
        tab({ id: 2, url: 'about:blank' })
      ]);

    expect(ok).toBe(false);
    expect(folders()).toHaveLength(0);
  });

  it('按归一化 URL 去重（同站点不同路径归为一个条目）', async () => {
    const ok = await useDataStore
      .getState()
      .createFolderFromNativeGroup('组', [
        tab({ id: 1, url: 'https://a.com/x' }),
        tab({ id: 2, url: 'https://a.com/x' })
      ]);

    expect(ok).toBe(true);
    expect(folders()[0]!.items).toHaveLength(1);
  });

  it('建立与组内标签的绑定，但排除已固定与已绑定他项的标签', async () => {
    await updateSession({ itemTabBindings: { other: 99 } });

    const ok = await useDataStore
      .getState()
      .createFolderFromNativeGroup('组', [
        tab({ id: 1, url: 'https://a.com/' }),
        tab({ id: 2, url: 'https://b.com/', pinned: true }),
        tab({ id: 99, url: 'https://c.com/' })
      ]);

    expect(ok).toBe(true);
    const session = await readSession();
    const itemIds = folders()[0]!.items.map((item) => item.id);
    // 只有 a.com 建立了绑定：b 已固定、c 已被别的条目占用
    expect(session.itemTabBindings[itemIds[0]!]).toBe(1);
    expect(Object.keys(session.itemTabBindings).filter((id) => itemIds.includes(id))).toHaveLength(
      1
    );
  });
});

describe('syncFolderToNativeGroup', () => {
  it('文件夹不存在或无可用条目时返回 false', async () => {
    await expect(useDataStore.getState().syncFolderToNativeGroup('missing')).resolves.toBe(false);
  });

  it('条目都没有 URL 时返回 false', async () => {
    await useDataStore.getState().createFolder('空');
    const folderId = folders()[0]!.id;

    await expect(useDataStore.getState().syncFolderToNativeGroup(folderId)).resolves.toBe(false);
  });

  it('先恢复未打开的条目，再建组，成功后删除固定文件夹并刷新', async () => {
    const { folderId } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    // 查询次数：① 判断是否已打开 ② openSavedItem 内部查询 ③ 建组前补查。
    // 用计数式 mock 而非 mockResolvedValueOnce 链，否则漏算 openSavedItem 的内部查询。
    let calls = 0;
    mocks.queryCurrentWindowTabs.mockImplementation(async () => {
      calls += 1;
      return calls <= 2
        ? [tab({ id: 1, windowId: 3 })]
        : [tab({ id: 900, url: 'https://a.com/', windowId: 3 })];
    });

    const ok = await useDataStore.getState().syncFolderToNativeGroup(folderId);

    expect(ok).toBe(true);
    expect(mocks.groupTabs).toHaveBeenCalledWith([900]);
    expect(mocks.updateGroupMeta).toHaveBeenCalledWith(500, '工作');
    // 收敛等待必须先于删除：否则 UI 会短暂拿到未收敛的中间态
    expect(mocks.waitForTabGroupAssignment).toHaveBeenCalledWith([900], 500);
    expect(folders()).toHaveLength(0);
    expect(mocks.requestRefresh).toHaveBeenCalled();
  });

  it('排除已固定 / 隐身 / 已属于其他原生组的标签（tabs.group 是移动语义，会拆散用户的组）', async () => {
    const { folderId } = await seedFolder('工作', [
      { url: 'https://a.com/' },
      { url: 'https://b.com/' },
      { url: 'https://c.com/' }
    ]);
    mocks.queryCurrentWindowTabs.mockResolvedValue([
      tab({ id: 1, url: 'https://a.com/', pinned: true }),
      tab({ id: 2, url: 'https://b.com/', incognito: true }),
      tab({ id: 3, url: 'https://c.com/', groupId: 77 })
    ]);

    const ok = await useDataStore.getState().syncFolderToNativeGroup(folderId);

    // 三个条目都不可用 → 没有成员 → 不做任何破坏性操作
    expect(ok).toBe(false);
    expect(mocks.groupTabs).not.toHaveBeenCalled();
    expect(folders()).toHaveLength(1);
  });

  it('建组失败（平台层返回 undefined）时保留固定文件夹', async () => {
    const { folderId } = await seedFolder('工作', [{ url: 'https://a.com/' }]);
    mocks.queryCurrentWindowTabs.mockResolvedValue([tab({ id: 1, url: 'https://a.com/' })]);
    mocks.groupTabs.mockResolvedValueOnce(undefined);

    const ok = await useDataStore.getState().syncFolderToNativeGroup(folderId);

    expect(ok).toBe(false);
    expect(folders()).toHaveLength(1);
  });
});
