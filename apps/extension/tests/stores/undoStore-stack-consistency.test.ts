// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { translate } from '@/i18n';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import {
  redoRepository,
  settingsRepository,
  undoRepository
} from '@/platform/storage/repositories';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 撤销/重做双栈的跨栈一致性（C3）。
 *
 * undo 与 redo 是两个独立存储键。一次撤销要同时改这两个键（undo 出栈 + redo 入栈），
 * 分两次拿锁写时，中途崩溃/写失败会留下「undo 已出栈、redo 未入栈」：重启后表现为
 * 「撤销已生效但重做为空」——用户拿不回刚撤销的东西，界面却刚承诺过可重做。
 *
 * 要钉死的两件事：
 *  1. 两次写入落在**同一个跨页锁内的同一段临界区**，且顺序是 redo 先写；
 *  2. 任一写入失败时**整体回退内存态**并给出可见回执，不留「撤销已生效但重做为空」
 *     的静默态。
 */

const mocks = vi.hoisted(() => ({
  /** UNDO_PERSIST_LOCK 的进锁次数（双栈同写必须只进一次）。 */
  lockEntries: 0
}));

vi.mock('@/platform/storage/crossPageLock', async () => {
  const actual = await vi.importActual<typeof import('@/platform/storage/crossPageLock')>(
    '@/platform/storage/crossPageLock'
  );
  return {
    ...actual,
    withCrossPageLock: (name: string, fn: () => Promise<unknown>) => {
      if (name === actual.UNDO_PERSIST_LOCK) mocks.lockEntries += 1;
      return actual.withCrossPageLock(name, fn);
    }
  };
});

/** 写盘失败提示文案（与 undoStore 的 showToast 同源）。 */
const PERSIST_NOTE = translate('撤销记录未能写入磁盘，重启后可能无法撤销');

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

/** 记录两个仓库的写入顺序，并可单独让其中一个失败。 */
function spyWrites(opts: { undoOk?: boolean; redoOk?: boolean } = {}) {
  const order: string[] = [];
  vi.spyOn(redoRepository, 'write').mockImplementation(async () => {
    order.push('redo');
    return opts.redoOk ?? true;
  });
  vi.spyOn(undoRepository, 'write').mockImplementation(async () => {
    order.push('undo');
    return opts.undoOk ?? true;
  });
  return order;
}

beforeEach(async () => {
  mocks.lockEntries = 0;
  await settingsRepository.write({ ...DEFAULT_SETTINGS, persistUndo: true });
  useTabStore.setState({
    tabs: [],
    groups: [],
    currentWindowId: 1,
    closeTabs: async (tabIds: readonly number[]) => [...tabIds]
  });
  useUndoStore.setState({ batches: [], redoBatches: [], toast: null, ready: false });
  vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({
    id: 99,
    index: 0,
    windowId: 1,
    active: false,
    pinned: false
  } as never);
  // 复用豁免按「已确认」桩掉：本文件只测双栈一致性。
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
    Promise.resolve({ ok: true })) as never);
});

afterEach(() => {
  fakeBrowser.reset();
  useUndoStore.getState().clearToast();
  vi.restoreAllMocks();
});

describe('一次撤销的双栈写入', () => {
  it('两次写入落在同一个跨页锁内，且 redo 先于 undo', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/' });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);
    const order = spyWrites();
    const lockBefore = mocks.lockEntries;

    await useUndoStore.getState().undo();

    // 一次撤销只进一次 UNDO_PERSIST_LOCK：两次写入在同一段临界区内
    expect(mocks.lockEntries - lockBefore).toBe(1);
    // 顺序：崩溃窗口里宁可留下「redo 多一条重复项」，也不能「撤销已生效但重做为空」
    expect(order).toEqual(['redo', 'undo']);
  });

  it('redo 写失败时整体回退内存态，并给出可见回执（不留「撤销已生效但重做为空」的静默态）', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/' });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);
    const beforeBatches = useUndoStore.getState().batches;
    // undo 写成功、redo 写失败：正是「撤销已出栈、重做未入栈」的形态
    spyWrites({ undoOk: true, redoOk: false });

    await useUndoStore.getState().undo();

    // 内存态回到撤销前：撤销批次仍在撤销栈、重做栈为空 —— 与磁盘一致
    expect(useUndoStore.getState().batches).toEqual(beforeBatches);
    expect(useUndoStore.getState().redoBatches).toEqual([]);
    // 回执必须说出来：否则用户只看到「已恢复 N 个」，不知道重做/持久化不成立
    expect(useUndoStore.getState().toast?.note).toBe(PERSIST_NOTE);
  });

  it('undo 写失败同样整体回退（两栈一起落盘或一起不落）', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/' });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);
    const beforeBatches = useUndoStore.getState().batches;
    spyWrites({ undoOk: false, redoOk: true });

    await useUndoStore.getState().undo();

    expect(useUndoStore.getState().batches).toEqual(beforeBatches);
    expect(useUndoStore.getState().redoBatches).toEqual([]);
    expect(useUndoStore.getState().toast?.note).toBe(PERSIST_NOTE);
  });

  it('双栈都写成功时按预期出栈/入栈（不误伤正常路径）', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/' });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);
    spyWrites();

    await useUndoStore.getState().undo();

    expect(useUndoStore.getState().batches).toEqual([]);
    expect(useUndoStore.getState().redoBatches).toHaveLength(1);
    expect(useUndoStore.getState().toast?.note).toBeUndefined();
  });
});
