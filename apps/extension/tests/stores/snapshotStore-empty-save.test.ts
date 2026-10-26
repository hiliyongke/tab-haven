// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabRecord } from '@/core/tab-types';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 空现场不落快照（S8）。
 *
 * `collectSnapshotTabs` 过滤后为空时仍照样落盘，会产出一条 tabCount=0 的快照：
 * 它既不可恢复，又占掉一个命名快照名额（SNAPSHOTS_LIMIT），而
 * `replaceSpaceSnapshot`（platform/snapshot/snapshots.ts）对空现场有明确拒绝 ——
 * 两条保存路径对同一现场的判定必须同口径。
 *
 * 与 `archiveCurrentWindow` 的「只保存可恢复标签」同口径：拿不出可恢复内容就
 * 明说，而不是落一条空的。
 */

const tabState: { tabs: TabRecord[] } = { tabs: [] };

vi.mock('@/platform/tabs', async () => {
  const actual = await vi.importActual<typeof import('@/platform/tabs')>('@/platform/tabs');
  return {
    ...actual,
    queryCurrentWindowTabs: async () => tabState.tabs,
    queryWindowGroups: async () => []
  };
});

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

describe('空现场的保存', () => {
  beforeEach(() => {
    // 当前窗口只有内部页（chrome://）：collectSnapshotTabs 过滤后为空
    tabState.tabs = [makeTab({ id: 11, url: 'chrome://newtab/' })];
    useSnapshotStore.setState({ snapshots: [], ready: false });
    useUndoStore.setState({ batches: [], toast: null, ready: false });
    useUndoStore.getState().clearToast();
  });

  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('saveCurrentWindow：不落空快照，并给出可见回执', async () => {
    const saved = await useSnapshotStore.getState().saveCurrentWindow('x');

    // 返回值是「有没有真的保存」的机器可读信号：调用方据此中止后续步骤。
    expect(saved).toBe(false);
    expect(useSnapshotStore.getState().snapshots).toHaveLength(0);
    // 必须可提示：静默 return 会让用户以为保存成功了
    expect(useUndoStore.getState().toast?.message).toBeTruthy();
    expect(useUndoStore.getState().toast?.tone).toBe('error');
  });

  it('saveSpace：同样不落空工作区快照（换过去等于清空窗口且无从恢复）', async () => {
    const saved = await useSnapshotStore.getState().saveSpace('工作区');

    expect(saved).toBe(false);
    expect(useSnapshotStore.getState().snapshots).toHaveLength(0);
    expect(useUndoStore.getState().toast?.tone).toBe('error');
  });

  it('有可保存标签时照常落盘（不误伤正常路径）', async () => {
    tabState.tabs = [makeTab({ id: 11, url: 'https://a.com/', title: 'A' })];

    const saved = await useSnapshotStore.getState().saveCurrentWindow('x');

    expect(saved).toBe(true);
    expect(useSnapshotStore.getState().snapshots).toHaveLength(1);
  });

  it('有可保存标签时 saveSpace 同样返回 true', async () => {
    tabState.tabs = [makeTab({ id: 11, url: 'https://a.com/', title: 'A' })];

    const saved = await useSnapshotStore.getState().saveSpace('工作区');

    expect(saved).toBe(true);
    expect(useSnapshotStore.getState().snapshots).toHaveLength(1);
  });
});
