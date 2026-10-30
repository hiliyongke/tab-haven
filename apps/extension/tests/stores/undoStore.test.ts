// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabRecord } from '@/core/tab-types';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { redoRepository, settingsRepository } from '@/platform/storage/repositories';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';

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

/**
 * undoStore 编排行为：
 *  - closeWithUndo 只记录非固定标签，且按实际关闭结果记录（部分失败不算）；
 *  - 记录最小五元组（URL/位置/固定/静音/分组归属）+ 组名；
 *  - undo 弹栈恢复并清空提示条；
 *  - load 在 persistUndo 关闭时清空持久化批次。
 */
describe('undoStore', () => {
  beforeEach(() => {
    // 关闭路径统一 mock：返回全部传入 id（模拟全部关闭成功），
    // 避免依赖 fake-browser 的 tabs.remove 内部状态。
    useTabStore.setState({
      tabs: [],
      groups: [],
      // undo 需要当前窗口 id（恢复目标窗口），缺省会提前返回不弹栈。
      currentWindowId: 1,
      closeTabs: async (tabIds: readonly number[]) => [...tabIds]
    });
  });

  afterEach(() => {
    fakeBrowser.reset();
    useUndoStore.getState().clearToast();
    useUndoStore.setState({ batches: [], toast: null, ready: false });
    vi.restoreAllMocks();
  });

  it('closeWithUndo 返回本次批次 id，记录五元组并可撤销', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/', index: 3 });
    const batchId = await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    expect(useUndoStore.getState().batches).toHaveLength(1);
    expect(batchId).toBe(useUndoStore.getState().batches[0]!.id);
    expect(useUndoStore.getState().batches[0]!.entries[0]).toMatchObject({
      url: 'https://a.com/',
      index: 3,
      pinned: false,
      muted: false,
      groupId: -1
    });
    expect(useUndoStore.getState().toast?.canUndo).toBe(true);
  });

  it('固定标签跳过：不关闭、不记录、不返回批次 id', async () => {
    const pinned = makeTab({ id: 1, pinned: true });
    const batchId = await useUndoStore.getState().closeWithUndo([pinned], [pinned.id]);

    expect(batchId).toBeUndefined();
    expect(useUndoStore.getState().batches).toHaveLength(0);
    expect(useUndoStore.getState().toast?.canUndo).toBe(false);
  });

  it('目标已消失或实际未关闭时返回 undefined，不伪造批次 id', async () => {
    const missing = await useUndoStore.getState().closeWithUndo([], [999]);
    expect(missing).toBeUndefined();

    const tab = makeTab({ id: 1, url: 'https://a.com/' });
    useTabStore.setState({ closeTabs: async () => [] });
    const failed = await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    expect(failed).toBeUndefined();
    expect(useUndoStore.getState().batches).toHaveLength(0);
    expect(useUndoStore.getState().toast?.batchId).toBeUndefined();
  });

  it('记录组名（组存在时）', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/', groupId: 5 });
    useTabStore.setState({ groups: [{ id: 5, title: '工作' }] });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    expect(useUndoStore.getState().batches[0]!.entries[0]!.groupName).toBe('工作');
  });

  it('部分关闭失败时按实际结果记录（skipped 提示）', async () => {
    const tabA = makeTab({ id: 1, url: 'https://a.com/' });
    const tabB = makeTab({ id: 2, url: 'https://b.com/' });
    useTabStore.setState({
      closeTabs: async () => [1] // 只成功关闭 tabA
    });
    await useUndoStore.getState().closeWithUndo([tabA, tabB], [tabA.id, tabB.id]);

    const batch = useUndoStore.getState().batches[0]!;
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]!.url).toBe('https://a.com/');
    expect(useUndoStore.getState().toast?.canUndo).toBe(true);
  });

  it('undo 弹栈恢复并清空提示条', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/', index: 3 });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    // 恢复路径：新建标签（fake-browser 驱动 restoreTabRecordsDetailed）
    vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({
      id: 99,
      index: 3,
      windowId: 1,
      active: false,
      pinned: false
    } as never);

    await useUndoStore.getState().undo();

    expect(useUndoStore.getState().batches).toHaveLength(0);
    expect(useUndoStore.getState().toast?.canUndo).toBe(false);
    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://a.com/', index: 3 })
    );
  });

  it('恢复失败时保留失败条目（成功才提交，不静默丢弃撤销记录）', async () => {
    const tabA = makeTab({ id: 1, url: 'https://a.com/', index: 0 });
    const tabB = makeTab({ id: 2, url: 'https://b.com/', index: 1 });
    await useUndoStore.getState().closeWithUndo([tabA, tabB], [tabA.id, tabB.id]);
    expect(useUndoStore.getState().batches[0]!.entries).toHaveLength(2);

    // 只让 b.com 恢复失败（a.com 成功），模拟部分失败。
    vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async (info: { url?: string }) => {
      if (info.url?.includes('b.com')) throw new Error('cannot create');
      return { id: 99, index: 0, windowId: 1, active: false, pinned: false };
    }) as never);

    await useUndoStore.getState().undo();

    const batches = useUndoStore.getState().batches;
    expect(batches).toHaveLength(1);
    // 成功项已出栈，失败项保留在栈顶，可再次撤销重试
    expect(batches[0]!.entries).toHaveLength(1);
    expect(batches[0]!.entries[0]!.url).toBe('https://b.com/');
    expect(useUndoStore.getState().toast?.message).toContain('1');
  });

  it('恢复全部失败时整批保留（可重试，不会变成丢标签）', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/', index: 0 });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async () => {
      throw new Error('cannot create');
    }) as never);

    await useUndoStore.getState().undo();

    expect(useUndoStore.getState().batches).toHaveLength(1);
    expect(useUndoStore.getState().batches[0]!.entries).toHaveLength(1);
  });

  it('重做只关闭本次恢复的标签，不因同 URL 关掉原 keeper', async () => {
    // Given 撤销恢复出 id=2；窗口里另有 id=1 的同 URL keeper，且它排在前面
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    const closeTabs = vi.fn(async (tabIds: readonly number[]) => [...tabIds]);
    useTabStore.setState({ closeTabs });
    const original = makeTab({ id: 10, url: 'https://same.example/' });
    await useUndoStore.getState().closeWithUndo([original], [original.id]);
    vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({
      id: 2,
      index: 0,
      windowId: 1,
      active: false,
      pinned: false
    } as never);
    await useUndoStore.getState().undo();
    const tabPlatform = await import('@/platform/tabs');
    vi.spyOn(tabPlatform, 'queryWindowTabs').mockResolvedValue([
      makeTab({ id: 1, url: 'https://same.example/' }),
      makeTab({ id: 2, url: 'https://same.example/', index: 1 })
    ]);
    closeTabs.mockClear();

    // When
    await useUndoStore.getState().redo();

    // Then 身份匹配是权威口径，不回退 URL 选中 keeper
    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(closeTabs).toHaveBeenCalledWith([2]);
  });

  it('失败重试没有新重做项时保留原恢复 id，后续重做仍不会误关同 URL keeper', async () => {
    // Given 首次只恢复 A 为 id=2，B 留在同 id 撤销批次等待重试
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    const closeTabs = vi.fn(async (tabIds: readonly number[]) => [...tabIds]);
    useTabStore.setState({ closeTabs });
    const tabA = makeTab({ id: 10, url: 'https://same.example/' });
    const tabB = makeTab({ id: 11, url: 'https://b.com/', index: 1 });
    const batchId = await useUndoStore.getState().closeWithUndo([tabA, tabB], [tabA.id, tabB.id]);
    vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async (info: { url?: string }) => {
      if (info.url?.includes('b.com')) throw new Error('cannot create');
      return { id: 2, index: 0, windowId: 1, active: false, pinned: false };
    }) as never);
    await useUndoStore.getState().undo();
    expect(useUndoStore.getState().redoBatches[0]?.id).toBe(batchId);

    // When 重试 B 仍失败，本次没有新 redoBatch，但首次产生的 redo 项仍在
    await useUndoStore.getState().undo();
    expect(useUndoStore.getState().redoBatches[0]?.id).toBe(batchId);
    const tabPlatform = await import('@/platform/tabs');
    vi.spyOn(tabPlatform, 'queryWindowTabs').mockResolvedValue([
      makeTab({ id: 1, url: 'https://same.example/' }),
      makeTab({ id: 2, url: 'https://same.example/', index: 1 })
    ]);
    closeTabs.mockClear();
    await useUndoStore.getState().redo();

    // Then 首次记录的真实 id 仍生效，只关闭 restored=2，不关闭 keeper=1
    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(closeTabs).toHaveBeenCalledWith([2]);
  });

  it('多次部分恢复合并为一个重做批次，并保留全部真实标签 id', async () => {
    // Given 首次 A 恢复为 id=2、B 失败；第二次重试 B 恢复为 id=3。
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
    const closeTabs = vi.fn(async (tabIds: readonly number[]) => [...tabIds]);
    useTabStore.setState({ closeTabs });
    const tabA = makeTab({ id: 10, url: 'https://same.example/' });
    const tabB = makeTab({ id: 11, url: 'https://b.com/', index: 1 });
    await useUndoStore.getState().closeWithUndo([tabA, tabB], [tabA.id, tabB.id]);
    let bAttempts = 0;
    vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async (info: { url?: string }) => {
      if (info.url?.includes('b.com')) {
        bAttempts += 1;
        if (bAttempts === 1) throw new Error('first attempt failed');
        return { id: 3, index: 1, windowId: 1, active: false, pinned: false };
      }
      return { id: 2, index: 0, windowId: 1, active: false, pinned: false };
    }) as never);
    await useUndoStore.getState().undo();

    // When 第二次重试也产生一个部分成功项。
    await useUndoStore.getState().undo();

    // Then 不重复压入同 id 批次，两次恢复产物合并为一次重做。
    const redoBatches = useUndoStore.getState().redoBatches;
    expect(redoBatches).toHaveLength(1);
    expect(redoBatches[0]?.entries.map((entry) => entry.url)).toEqual([
      'https://same.example/',
      'https://b.com/'
    ]);
    const persistedRedo = await redoRepository.readStrict();
    expect(persistedRedo).toHaveLength(1);
    expect(persistedRedo[0]?.entries.map((entry) => entry.url)).toEqual([
      'https://same.example/',
      'https://b.com/'
    ]);
    const tabPlatform = await import('@/platform/tabs');
    vi.spyOn(tabPlatform, 'queryWindowTabs').mockResolvedValue([
      makeTab({ id: 1, url: 'https://same.example/' }),
      makeTab({ id: 2, url: 'https://same.example/', index: 1 }),
      makeTab({ id: 3, url: 'https://b.com/', index: 2 })
    ]);
    closeTabs.mockClear();
    await useUndoStore.getState().redo();
    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(closeTabs).toHaveBeenCalledWith([2, 3]);
  });

  it('恢复窗口不可用时保留撤销批次', async () => {
    // 恢复窗口不可用时保留记录，供用户再次尝试撤销。
    const tab = makeTab({ id: 1, url: 'https://a.com/', index: 0 });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);
    expect(useUndoStore.getState().batches).toHaveLength(1);

    const restoreModule = await import('@/platform/tabs');
    const spy = vi
      .spyOn(restoreModule, 'resolveRestoreWindowId')
      .mockResolvedValue(undefined as never);

    await useUndoStore.getState().undo();

    expect(useUndoStore.getState().batches).toHaveLength(1);
    expect(useUndoStore.getState().batches[0]!.entries).toHaveLength(1);
    expect(useUndoStore.getState().toast?.canUndo).toBe(false);
    spy.mockRestore();
  });

  it('undo 无批次时无操作', async () => {
    await expect(useUndoStore.getState().undo()).resolves.toBeUndefined();
    expect(useUndoStore.getState().batches).toHaveLength(0);
  });
});
