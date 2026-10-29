// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { translate } from '@/i18n';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { settingsRepository, undoRepository } from '@/platform/storage/repositories';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 撤销记录写入失败时，本次撤销回执显示提示；后续写入成功的操作不显示该提示。
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

/** 写盘失败提示文案（与 undoStore 的 showToast 同源，语言无关地取译文）。 */
const PERSIST_NOTE = translate('撤销记录未能写入磁盘，重启后可能无法撤销');

beforeEach(async () => {
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
  // 复用豁免按「已确认」桩掉：本文件只测写盘失败回执。豁免未获确认会让
  // restoreTabRecordsDetailed 置起 degraded，其 note 占掉提示条唯一的 note 槽，
  // 把「未能写入磁盘」挤掉（note 取 `toast.note ?? persistNote`）。
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
    Promise.resolve({ ok: true })) as never);
});

afterEach(() => {
  fakeBrowser.reset();
  useUndoStore.getState().clearToast();
  vi.restoreAllMocks();
});

describe('撤销栈写盘失败的回执', () => {
  it('写盘失败时本次撤销回执即告知（不是滞留到下一次提示）', async () => {
    // Given 一次可撤销的关闭
    const tab = makeTab({ id: 1, url: 'https://a.com/' });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    // When 撤销栈写盘失败，随后执行一次撤销
    vi.spyOn(undoRepository, 'write').mockResolvedValue(false);
    await useUndoStore.getState().undo();

    // Then 本次回执就带出说明（写盘失败意味着「已恢复」的承诺可能不成立）
    expect(useUndoStore.getState().toast?.note).toBe(PERSIST_NOTE);
  });

  it('标记只随本次回执消费：随后一次写盘成功的操作不再挂这条文案', async () => {
    const tab = makeTab({ id: 1, url: 'https://a.com/' });
    await useUndoStore.getState().closeWithUndo([tab], [tab.id]);

    // Given 上一次撤销的写盘失败（标记已消费过一次）
    const writeSpy = vi.spyOn(undoRepository, 'write').mockResolvedValue(false);
    await useUndoStore.getState().undo();
    expect(useUndoStore.getState().toast?.note).toBe(PERSIST_NOTE);

    // When 写盘恢复正常后再做一次关闭
    writeSpy.mockRestore();
    await useUndoStore.getState().closeWithUndo([makeTab({ id: 2, url: 'https://b.com/' })], [2]);

    // Then 本次回执不得再带「未能写入磁盘」（否则是假告警）
    expect(useUndoStore.getState().toast?.note).toBeUndefined();
    expect(useUndoStore.getState().toast?.message).not.toContain('磁盘');
  });
});
