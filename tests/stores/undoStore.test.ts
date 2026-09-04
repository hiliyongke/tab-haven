// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabRecord } from '@/core/tab-types';
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
 * undoStore 编排行为（FR-D8.1 / PRD 附录 C-6）：
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

  it('closeWithUndo 记录五元组并可撤销', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/', index: 3 });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    expect(useUndoStore.getState().batches).toHaveLength(1);
    expect(useUndoStore.getState().batches[0]!.entries[0]).toMatchObject({
      url: 'https://a.com/',
      index: 3,
      pinned: false,
      muted: false,
      groupId: -1
    });
    expect(useUndoStore.getState().toast?.canUndo).toBe(true);
  });

  it('固定标签跳过：不关闭、不记录', async () => {
    const pinned = makeTab({ id: 1, pinned: true });
    await useUndoStore.getState().closeWithUndo([pinned], [pinned.id]);

    expect(useUndoStore.getState().batches).toHaveLength(0);
    expect(useUndoStore.getState().toast?.canUndo).toBe(false);
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

    // 恢复路径：新建标签（fake-browser 驱动 restoreTabRecords）
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

  it('undo 无批次时无操作', async () => {
    await expect(useUndoStore.getState().undo()).resolves.toBeUndefined();
    expect(useUndoStore.getState().batches).toHaveLength(0);
  });
});
