// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { FixedFolder } from '@/core/schema/models';
import { buildDataContext } from '@/stores/data/context';
import type { Repositories } from '@/platform/registry';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 导入期间「写入被丢弃」的留痕合并（S10）。
 *
 * 导入事务持续数百 ms，期间拖拽/排序会连续触发 `writeFolders` —— 逐次留痕会在诊断
 * 环形缓冲里堆出上百条同文案记录，把真正的故障挤出缓冲（诊断导出是本项目唯一的
 * 排障通道）。故按分区合并：同一原因本会话内只留一次。
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
  it('导入进行中连续 20 次写入：每个分区的告知各只留 1 条（不刷满诊断缓冲）', async () => {
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
