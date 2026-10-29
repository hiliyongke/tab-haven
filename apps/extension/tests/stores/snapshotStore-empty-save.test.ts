// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabRecord } from '@/core/tab-types';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 保存行为规格：没有可恢复标签时，当前窗口与工作区都不保存空快照，并显示失败回执；
 * 存在可恢复标签时照常保存。
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

  it('saveSpace：空现场时拒绝保存并显示失败回执', async () => {
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
