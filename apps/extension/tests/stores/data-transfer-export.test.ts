// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { DataContext, DataState } from '@/stores/data/types';
import { createTransferSlice } from '@/stores/data/transferSlice';

describe('exportData 完整备份', () => {
  it('快照读取失败时中止导出，不生成缺失 snapshots 的备份', async () => {
    const snapshots = {
      readStrict: vi.fn().mockRejectedValue(new Error('snapshot storage down'))
    };
    const ctx = {
      get: () =>
        ({
          folders: [],
          pins: [],
          collapsedSites: [],
          settings: DEFAULT_SETTINGS
        }) as unknown as DataState,
      repos: { snapshots },
      isImporting: () => false,
      isClearing: () => false
    } as unknown as DataContext;

    await expect(createTransferSlice(ctx).exportData()).rejects.toThrow('snapshot storage down');
    expect(snapshots.readStrict).toHaveBeenCalledTimes(1);
  });
});
