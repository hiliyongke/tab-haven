// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { FixedFolder } from '@/core/schema/models';
import { buildDataContext } from '@/stores/data/context';
import type { Repositories } from '@/platform/registry';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 导入事务期间的降级留痕行为：同一分区的重复写入拒绝在本会话内只记录一次。
 */

const mocks = vi.hoisted(() => ({
  logDegraded: vi.fn(),
  logFailure: vi.fn()
}));

vi.mock('@/platform/diagnostics', () => ({
  logDegraded: mocks.logDegraded,
  logFailure: mocks.logFailure
}));

vi.mock('@/platform/storage/SyncMirror', () => ({
  syncMirror: {
    setMirrorResultHandlers: () => undefined,
    schedule: () => undefined,
    cancelPending: () => undefined,
    clearAll: async () => undefined,
    pull: async () => null,
    readLastPullIssue: () => 'none'
  }
}));

function repo<T>(value: T) {
  return { read: vi.fn(async () => value), write: vi.fn(async () => true), watch: vi.fn() };
}

function build(): { ctx: DataContext; state: Partial<DataState> } {
  const state: Partial<DataState> = {
    folders: [] as FixedFolder[],
    pins: [],
    collapsedSites: [],
    settings: DEFAULT_SETTINGS,
    boundTabIds: [],
    storageDegraded: false,
    mirrorIssue: null,
    mirrorWriteFailed: false,
    mirrorQuotaExceeded: false
  };
  const repos = {
    folders: repo([]),
    pins: repo([]),
    collapse: repo([]),
    settings: repo(DEFAULT_SETTINGS),
    seeded: repo(false)
  } as unknown as Repositories;
  const ctx = buildDataContext(
    (partial: Partial<DataState>) => Object.assign(state, partial),
    () => state as DataState,
    repos
  );
  return { ctx, state };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('导入期间的降级留痕', () => {
  it('导入期间连续写入时每个分区只记录一条', async () => {
    const { ctx } = build();
    ctx.setImporting(true);

    for (let i = 0; i < 20; i += 1) {
      await ctx.writeFolders([]);
      await ctx.writePins([]);
    }

    const messages = mocks.logDegraded.mock.calls.map((call) => String(call[1]));
    expect(messages.filter((m) => m.includes('固定空间'))).toHaveLength(1);
    expect(messages.filter((m) => m.includes('固定图标'))).toHaveLength(1);
  });
});
