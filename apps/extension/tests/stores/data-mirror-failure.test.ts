// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { buildDataContext } from '@/stores/data/context';
import type { Repositories } from '@/platform/registry';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 镜像写入失败时展示降级状态；后续写入成功或关闭同步后清除失败状态。
 * 容量超限与其他写入失败使用不同状态分类。
 */

/** 容量超限与其他镜像写入失败使用不同状态分类。 */
const mocks = vi.hoisted(() => ({
  handlers: {} as {
    onFailure?: (message: string, reason?: 'quota' | 'write') => void;
    onSuccess?: () => void;
  },
  schedule: vi.fn()
}));

vi.mock('@/platform/storage/SyncMirror', () => ({
  syncMirror: {
    // 捕获回执：镜像写结果由 platform 交回组合根，测试据此驱动置位/复位。
    setMirrorResultHandlers: (handlers: {
      onFailure: (message: string, reason?: 'quota' | 'write') => void;
      onSuccess: () => void;
    }) => {
      mocks.handlers = handlers;
    },
    schedule: mocks.schedule
  }
}));

function repo<T>(value: T) {
  return { read: vi.fn(async () => value), write: vi.fn(async () => true), watch: vi.fn() };
}

/** 用真实 `buildDataContext` 构造上下文：置位/复位都要走它内部的降级记账。 */
function build(): { ctx: DataContext; state: Partial<DataState> } {
  const state: Partial<DataState> = {
    folders: [],
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
  mocks.handlers = {};
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('首次镜像恢复闸门', () => {
  it('恢复待完成时禁止镜像写，完成后才放行', () => {
    const { ctx, state } = build();
    state.settings = { ...DEFAULT_SETTINGS, syncMirrorEnabled: true };

    ctx.setMirrorRestorePending(true);
    ctx.scheduleMirror(state as DataState);
    expect(mocks.schedule).not.toHaveBeenCalled();

    ctx.setMirrorRestorePending(false);
    ctx.scheduleMirror(state as DataState);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });
});

describe('镜像写失败态', () => {
  it('镜像写失败时设置失败标记与降级横幅', () => {
    // Given 开启同步、镜像写正常
    const { state } = build();
    expect(state.mirrorWriteFailed).toBe(false);

    // When 一次镜像写入失败（配额超限等）
    mocks.handlers.onFailure?.('同步镜像写入失败（超出配额）');

    // Then 状态行与横幅同时反映「本次改动没上传」
    expect(state.mirrorWriteFailed).toBe(true);
    expect(state.storageDegraded).toBe(true);
  });

  it('镜像写成功后复位失败标记', () => {
    // Given 上一轮失败过
    const { state } = build();
    mocks.handlers.onFailure?.('同步镜像写入失败（超出配额）');
    expect(state.mirrorWriteFailed).toBe(true);

    // When 后续一次镜像写入成功
    mocks.handlers.onSuccess?.();

    // Then 失败态与降级横幅一并复位
    expect(state.mirrorWriteFailed).toBe(false);
    expect(state.storageDegraded).toBe(false);
  });

  it('关闭同步后清除镜像写入失败状态', () => {
    // Given 同步开着且刚失败过（云端仍留着旧镜像）
    const { ctx, state } = build();
    mocks.handlers.onFailure?.('同步镜像写入失败（超出配额）');
    expect(state.mirrorWriteFailed).toBe(true);
    expect(state.storageDegraded).toBe(true);

    // When 用户关闭同步（镜像已清、不会再有写回执）
    ctx.resetMirrorFailure();

    // Then 失败标记与存储降级状态均复位
    expect(state.mirrorWriteFailed).toBe(false);
    expect(state.storageDegraded).toBe(false);
  });
});

describe('镜像写失败的成因区分', () => {
  it('容量超限与其他写入失败使用不同状态标记', () => {
    // Given 一次普通写失败
    const write = build();
    mocks.handlers.onFailure?.('同步镜像写入失败', 'write');
    expect(write.state.mirrorWriteFailed).toBe(true);
    expect(write.state.mirrorQuotaExceeded).toBe(false);

    // When 一次容量超限导致的写失败
    const quota = build();
    mocks.handlers.onFailure?.('同步镜像写入失败：超出同步容量上限', 'quota');

    // Then 两者都可识别为「写失败」，但只有后者标记容量超限
    expect(quota.state.mirrorWriteFailed).toBe(true);
    expect(quota.state.mirrorQuotaExceeded).toBe(true);
    expect(quota.state.mirrorQuotaExceeded).not.toBe(write.state.mirrorQuotaExceeded);
  });

  it('写成功后复位容量超限与失败标记', () => {
    const { state } = build();
    mocks.handlers.onFailure?.('同步镜像写入失败：超出同步容量上限', 'quota');
    expect(state.mirrorQuotaExceeded).toBe(true);

    mocks.handlers.onSuccess?.();

    expect(state.mirrorQuotaExceeded).toBe(false);
    expect(state.mirrorWriteFailed).toBe(false);
  });
});
