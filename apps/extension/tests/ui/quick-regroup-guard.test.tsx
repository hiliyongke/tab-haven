// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { translate } from '@/i18n';
import * as autoGrouping from '@/core/group/AutoGrouping';
import * as autoGroupSync from '@/platform/group/AutoGroupSync';
import App from '@/entrypoints/sidepanel/App';

/**
 * 快速整理前保存当前窗口的撤销快照：保存失败时不执行重排，保存成功时执行重排。
 */

function tab(partial: Partial<TabRecord> & { id: number }): TabRecord {
  return {
    windowId: 1,
    index: partial.id,
    active: false,
    pinned: false,
    incognito: false,
    groupId: NO_GROUP,
    title: `tab-${partial.id}`,
    url: `https://site${partial.id}.com/`,
    ...partial
  };
}

function primeStores(): void {
  useTabStore.setState({
    tabs: [tab({ id: 1 }), tab({ id: 2 })],
    groups: [],
    currentWindowId: 1,
    tabSyncReady: true,
    highlightedIds: new Set<number>()
  });
  useDataStore.setState({
    settings: { ...DEFAULT_SETTINGS, onboarded: true, tipSeen: true },
    folders: [],
    pins: [],
    collapsedSites: [],
    boundTabIds: [],
    ready: true,
    storageDegraded: false
  });
  useUndoStore.setState({ batches: [], toast: null, ready: true, undoing: false });
  useSnapshotStore.setState({ snapshots: [], ready: true });
}

/** 提供可执行的重排计划。 */
function stubPlan(): void {
  vi.spyOn(autoGrouping, 'planRegroup').mockReturnValue({
    ungroupTabIds: [1, 2],
    plans: [{ title: 'site1.com', color: 'blue', tabIds: [1] }]
  });
}

function renderApp(): void {
  vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
  vi.spyOn(tabSyncService, 'requestRefresh').mockImplementation(() => undefined);
  vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
  primeStores();
  render(<App />);
}

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('handleQuickRegroup 快照保存与重排', () => {
  it('saveCurrentWindow 返回 false 时：不执行 regroupTempArea', async () => {
    stubPlan();
    // 现场为空/只剩内部页：store 返回 false 且已自行 notifyError。
    vi.spyOn(useSnapshotStore.getState(), 'saveCurrentWindow').mockResolvedValue(false);
    const regroup = vi.spyOn(autoGroupSync, 'regroupTempArea').mockResolvedValue(1);
    renderApp();

    const button = await screen.findByRole('button', {
      name: translate('重排分组（自动存快照可回退）')
    });
    fireEvent.click(button);

    // 快照保存失败时不执行 regroupTempArea。
    await waitFor(() =>
      expect(useSnapshotStore.getState().saveCurrentWindow).toHaveBeenCalledTimes(1)
    );
    expect(regroup).not.toHaveBeenCalled();
  });

  it('saveCurrentWindow 返回 true 时：正常执行 regroupTempArea', async () => {
    stubPlan();
    vi.spyOn(useSnapshotStore.getState(), 'saveCurrentWindow').mockResolvedValue(true);
    const regroup = vi.spyOn(autoGroupSync, 'regroupTempArea').mockResolvedValue(1);
    renderApp();

    const button = await screen.findByRole('button', {
      name: translate('重排分组（自动存快照可回退）')
    });
    fireEvent.click(button);

    await waitFor(() => expect(regroup).toHaveBeenCalledTimes(1));
  });
});
