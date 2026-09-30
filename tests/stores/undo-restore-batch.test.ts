// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type UndoBatch } from '@/core/schema/models';
import { settingsRepository } from '@/platform/storage/repositories';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 撤销「快照恢复」批次（kind='restore'）必须**关闭**这批标签。
 *
 * 该批次记的是快照恢复新建出来、此刻仍开着的标签。常规撤销分支是「重新打开」，
 * 走它会命中 RestoreEngine 的「已打开去重」全部判成功 —— 批次出栈、提示
 * 「已恢复 N 个」而界面毫无变化：既空转又给假回执。关闭后生成的普通批次
 * （kind='restore-undo'）仍可再被撤销，于是能再开回来。
 *
 * 桩的范围：窗口解析（避免依赖浏览器 windows API）、目标窗口标签查询（构造
 * 现场）、closeTabs（fake-browser 的 tabs.remove 在本环境抛 TypeError，不稳定，
 * 因此断言「关闭请求带上了正确的 tabId」而不是浏览器内部状态）。
 */

// vi.mock 会被提升到文件顶部：桩函数必须经 vi.hoisted 声明，否则 mock 工厂
// 求值时它还在 TDZ 里（Cannot access before initialization）。
const { queryWindowTabs, closeTabs } = vi.hoisted(() => ({
  queryWindowTabs: vi.fn(),
  closeTabs: vi.fn(async (ids: readonly number[]) => [...ids])
}));

vi.mock('@/platform/tabs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/tabs')>()),
  resolveRestoreWindowId: vi.fn().mockResolvedValue(1),
  queryWindowTabs,
  closeTabs
}));

const URLS = ['https://a.example/1', 'https://a.example/2'];

const records = URLS.map((url, index) => ({
  id: index + 1,
  windowId: 1,
  index,
  url,
  title: url,
  pinned: false,
  groupId: -1
}));

const restoreBatch = (id: string): UndoBatch => ({
  id,
  kind: 'restore',
  createdAt: 1,
  windowId: 1,
  entries: records.map((record, index) => ({
    url: record.url,
    index,
    pinned: false,
    muted: false,
    groupId: -1
  }))
});

afterEach(() => {
  fakeBrowser.reset();
  useUndoStore.setState({ batches: [], redoBatches: [], toast: null, ready: false });
  queryWindowTabs.mockReset();
  closeTabs.mockClear();
  closeTabs.mockImplementation(async (ids: readonly number[]) => [...ids]);
});

describe('撤销 kind=restore 的批次', () => {
  it('关闭这批标签（而非重新打开），并留下可再次撤销的关闭批次', async () => {
    // 关闭持久化：否则 undo 会先做「磁盘上有没有该批次」的跨页复核并早退。
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    queryWindowTabs.mockResolvedValue(records);
    useUndoStore.setState({ batches: [restoreBatch('restore-1')], ready: true });

    await useUndoStore.getState().undo();

    // 1. 走的是关闭路径，且关闭对象就是这批标签（不是「提示已恢复但界面没变」）
    expect(closeTabs).toHaveBeenCalledWith([1, 2]);

    // 2. restore 批次已出栈，关闭结果作为普通批次留下（可再撤销开回来）
    const state = useUndoStore.getState();
    expect(state.batches.some((batch) => batch.id === 'restore-1')).toBe(false);
    expect(state.batches[0]?.kind).toBe('restore-undo');
    expect(state.batches[0]?.entries).toHaveLength(2);

    // 3. 回执是「已关闭」且可撤销，不是「已恢复」
    expect(state.toast?.canUndo).toBe(true);
    expect(state.toast?.batchId).toBe(state.batches[0]?.id);
    expect(state.toast?.message).toContain('2');
  });

  it('标签已被手动关掉时不静默：批次出栈并明确告知', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: false });
    queryWindowTabs.mockResolvedValue([]);
    useUndoStore.setState({ batches: [restoreBatch('restore-2')], ready: true });

    await useUndoStore.getState().undo();

    const state = useUndoStore.getState();
    expect(state.batches).toHaveLength(0);
    expect(closeTabs).not.toHaveBeenCalled();
    expect(state.toast?.message).toBeTruthy();
  });
});
