// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabRecord } from '@/core/tab-types';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import i18n from '@/i18n';
import { settingsRepository } from '@/platform/storage/repositories';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 淘汰提示（R18 / S-3）的**不刷屏**契约。
 *
 * 三类淘汰的共同形态：容量已满时「每触发一次操作就再淘汰一条」。批量关 50 个
 * 标签、连续暂存稍后读、逐份导入 Workona 都会连着触发几十次淘汰 —— 若每次都弹
 * toast，提示条会互相顶掉且刷屏，用户反而一条都看不到。故按 key 会话内合并一次。
 *
 * 这里只锁「合并」这一层（notifyEviction 的公共语义），三类淘汰各自的
 * 「淘汰项精确交出」由 tests/core/eviction-reporting.test.ts 覆盖。
 */

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

describe('notifyEviction 会话内合并', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      groups: [],
      currentWindowId: 1,
      closeTabs: async (tabIds: readonly number[]) => [...tabIds]
    });
  });

  afterEach(() => {
    fakeBrowser.reset();
    useUndoStore.setState({ batches: [], redoBatches: [], toast: null, ready: false });
    vi.restoreAllMocks();
  });

  it('同一 key 第二次调用不再覆盖提示条（不刷屏）', () => {
    const store = useUndoStore.getState();
    store.notifyEviction('k1', '第一批淘汰 3 条');
    const first = useUndoStore.getState().toast?.message;
    expect(first).toBe('第一批淘汰 3 条');

    store.notifyEviction('k1', '第二批淘汰 1 条');
    // 合并：仍是最初那条，未被顶掉
    expect(useUndoStore.getState().toast?.message).toBe('第一批淘汰 3 条');
  });

  it('不同 key 各自提示一次（三类淘汰互不压制）', () => {
    const store = useUndoStore.getState();
    store.notifyEviction('read-later', '稍后读淘汰');
    store.notifyEviction('snapshots', '快照淘汰');
    expect(useUndoStore.getState().toast?.message).toBe('快照淘汰');
    // 同类再次触发仍被合并
    store.notifyEviction('snapshots', '快照又淘汰');
    expect(useUndoStore.getState().toast?.message).toBe('快照淘汰');
  });

  it('淘汰提示是 info 而非 error：容量语义不是操作失败', () => {
    useUndoStore.getState().notifyEviction('k2', 'x');
    expect(useUndoStore.getState().toast?.tone).toBe('info');
  });

  it('撤销栈淘汰告知并入操作回执，且本会话内只提示一次', async () => {
    // 栈深设到最小档 5：入栈 6 批即触发首次淘汰，继续入栈会一次次再淘汰。
    await settingsRepository.write({ ...DEFAULT_SETTINGS, undoStackLimit: 5 });
    await useUndoStore.getState().load();

    for (let i = 1; i <= 6; i += 1) {
      await useUndoStore.getState().closeWithUndo([makeTab({ id: i })], [i]);
    }

    // 回归（R18）：淘汰发生在 appendBatch 内、回执在其后设置。若两者各占一条
    // 提示条，回执会覆盖淘汰告知，而 key 已标记为已提示 → 本会话内永久漏发。
    // 正确结果：回执是主消息，淘汰告知挂在 note 上同槽展示。
    const first = useUndoStore.getState();
    expect(first.batches).toHaveLength(5);
    expect(first.toast?.message).toBe(i18n.t('undo.closed', { count: 1 }));
    expect(first.toast?.note).toBe(i18n.t('undo.stackEvicted', { count: 1 }));

    // 继续关闭仍会淘汰，但同类淘汰本会话内不再提示（逐次提示会互相顶掉且刷屏）
    for (let i = 7; i <= 8; i += 1) {
      await useUndoStore.getState().closeWithUndo([makeTab({ id: i })], [i]);
    }

    const later = useUndoStore.getState();
    expect(later.batches).toHaveLength(5);
    expect(later.toast?.note).toBeUndefined();
  });
});
