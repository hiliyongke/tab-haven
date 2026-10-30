// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { translate } from '@/i18n';
import * as tabsPlatform from '@/platform/tabs';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { useBatchTabActions } from '@/entrypoints/sidepanel/hooks/useBatchTabActions';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useTabStore.setState({ tabs: [] });
  useUndoStore.setState({ toast: null });
});

describe('useBatchTabActions', () => {
  it('批量动作拒绝时展示失败提示并结束在途状态', async () => {
    const error = new Error('reload failed');
    useTabStore.setState({ tabs: [tab({ id: 1, discarded: true })] });
    const notifyFailure = vi
      .spyOn(useUndoStore.getState(), 'notifyFailure')
      .mockImplementation(() => undefined);
    const reloadTabs = vi.spyOn(tabsPlatform, 'reloadTabs').mockRejectedValue(error);
    const { result } = renderHook(() =>
      useBatchTabActions({
        t: translate,
        boundTabIds: [],
        discardTab: async () => false,
        closeWithUndo: async () => undefined
      })
    );

    act(() => result.current.wakeAll());
    await waitFor(() => {
      expect(notifyFailure).toHaveBeenCalledWith(
        'sidepanel',
        translate('操作失败，请稍后重试'),
        error
      );
    });

    expect(reloadTabs).toHaveBeenCalledWith([1]);
    expect(result.current.batchBusy).toBe('idle');
  });
});
