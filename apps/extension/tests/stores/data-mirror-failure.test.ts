// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { buildDataContext } from '@/stores/data/context';
import type { Repositories } from '@/platform/registry';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 镜像写失败态的置位与复位（`stores/data/context.ts`）。
 *
 * 两条必须成立的口径：
 *
 * 1. **写失败必须可见**：镜像走浏览器账号通道，失败时本地数据不受影响 ——
 *    正因如此它曾完全静默，用户一直以为同步在生效（`mirrorWriteFailed` 置位）。
 * 2. **关闭同步后必须显式复位**：此后不再有任何镜像写入，`onSuccess` 回调永远
 *    不会再来。若不在关闭路径复位，横幅与 `mirrorWriteFailed` 会永久粘住，
 *    而此时本地数据完好、用户也已经关掉了同步 —— 提示既过时又错配。
 */

/**
 * 写失败的**成因**必须可区分（M20 / S11）：`reason === 'quota'`（超出同步容量上限）
 * 是确定性故障，用户可以自己处理（删掉一些固定条目），UI 要显示
 * 「未生效（超出同步容量上限）」；普通写失败只需「本次改动未上传」。
 */
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

describe('镜像写失败态', () => {
  it('镜像写失败：置起 mirrorWriteFailed 与降级横幅（不是静默失败）', () => {
    // Given 开启同步、镜像写正常
    const { state } = build();
    expect(state.mirrorWriteFailed).toBe(false);

    // When 一次镜像写入失败（配额超限等）
    mocks.handlers.onFailure?.('同步镜像写入失败（超出配额）');

    // Then 状态行与横幅同时反映「本次改动没上传」
    expect(state.mirrorWriteFailed).toBe(true);
    expect(state.storageDegraded).toBe(true);
  });

  it('镜像写成功：复位失败态（quota 抖动恢复后告警要消失）', () => {
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

  it('关闭同步后复位失败态：此后不再有镜像写入，成功回调不会再来', () => {
    // Given 同步开着且刚失败过（云端仍留着旧镜像）
    const { ctx, state } = build();
    mocks.handlers.onFailure?.('同步镜像写入失败（超出配额）');
    expect(state.mirrorWriteFailed).toBe(true);
    expect(state.storageDegraded).toBe(true);

    // When 用户关闭同步（镜像已清、不会再有写回执）
    ctx.resetMirrorFailure();

    // Then 失败态必须显式复位，否则横幅永久粘住且与实际状态相反
    expect(state.mirrorWriteFailed).toBe(false);
    expect(state.storageDegraded).toBe(false);
  });
});

describe('镜像写失败的成因区分', () => {
  it('reason=quota 与 reason=write 给出不同状态（容量超限可被用户处理）', () => {
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

  it('写成功后容量标记一并复位（腾出容量后提示要消失）', () => {
    const { state } = build();
    mocks.handlers.onFailure?.('同步镜像写入失败：超出同步容量上限', 'quota');
    expect(state.mirrorQuotaExceeded).toBe(true);

    mocks.handlers.onSuccess?.();

    expect(state.mirrorQuotaExceeded).toBe(false);
    expect(state.mirrorWriteFailed).toBe(false);
  });
});
