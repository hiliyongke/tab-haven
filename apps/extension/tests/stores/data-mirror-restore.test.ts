// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 「开启同步」时的反向恢复（`stores/data/mirrorRestore.ts`）。
 *
 * 这段逻辑的成败决定换机时数据能不能回来，三条错了会丢用户数据：
 *
 * 1. **已 seeded 的老设备不得被陈旧镜像反向覆盖** —— 它本地即权威，直接短路返回；
 * 2. **镜像拿不到时不得推镜像** —— 本地是空态，推上去会覆盖旧设备留下的镜像，
 *    换机恢复与云端副本同时丢失（这是「failed / no-mirror」要分开上报的原因）；
 * 3. **写盘失败不置 seeded** —— 置位会让它永久失去重试机会。
 *
 * 另一条可见性要求：`pull()` 返回 null 有四种成因，这里必须把分类原样交给 store
 * （`mirrorIssue`），否则「镜像损坏」会被设置页说成「超出容量上限」。
 */

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  pullIssue: vi.fn(() => 'none' as 'none' | 'ok' | 'chunk-limit' | 'unreadable')
}));

vi.mock('@/platform/storage/SyncMirror', () => ({
  syncMirror: { pull: mocks.pull, readLastPullIssue: mocks.pullIssue }
}));

const folder = (id: string) => ({
  id,
  name: id,
  collapsed: false,
  createdAt: 1,
  items: []
});

interface Harness {
  ctx: DataContext;
  set: ReturnType<typeof vi.fn>;
  foldersWrite: ReturnType<typeof vi.fn>;
  pinsWrite: ReturnType<typeof vi.fn>;
  seededWrite: ReturnType<typeof vi.fn>;
  reportPersistenceFailure: ReturnType<typeof vi.fn>;
  run: () => Promise<string>;
}

async function harness(
  options: {
    seeded?: boolean;
    localFolders?: unknown[];
    localPins?: unknown[];
    foldersWriteOk?: boolean;
    pinsWriteOk?: boolean;
  } = {}
): Promise<Harness> {
  const set = vi.fn();
  const get = vi.fn(
    () =>
      ({
        folders: options.localFolders ?? [],
        pins: options.localPins ?? []
      }) as unknown as DataState
  );
  const foldersWrite = vi.fn(async () => options.foldersWriteOk ?? true);
  const pinsWrite = vi.fn(async () => options.pinsWriteOk ?? true);
  const seededWrite = vi.fn(async () => true);
  const reportPersistenceFailure = vi.fn();

  const ctx = {
    set,
    get,
    repos: {
      seeded: { read: vi.fn(async () => options.seeded ?? false), write: seededWrite },
      folders: { read: vi.fn(async () => options.localFolders ?? []), write: foldersWrite },
      pins: { read: vi.fn(async () => options.localPins ?? []), write: pinsWrite }
    },
    reportPersistenceFailure
  } as unknown as DataContext;

  const { restoreFromMirrorOnEnable } = await import('@/stores/data/mirrorRestore');
  return {
    ctx,
    set,
    foldersWrite,
    pinsWrite,
    seededWrite,
    reportPersistenceFailure,
    run: () => restoreFromMirrorOnEnable(ctx)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pull.mockResolvedValue(null);
  mocks.pullIssue.mockReturnValue('none');
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('restoreFromMirrorOnEnable', () => {
  it('已 seeded 的老设备：短路返回，不拉取镜像（本地即权威）', async () => {
    const h = await harness({ seeded: true });

    await expect(h.run()).resolves.toBe('already-seeded');
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('通道里没有镜像（从未同步过）：本地即首份镜像，分类为 none', async () => {
    mocks.pull.mockResolvedValueOnce(null);
    mocks.pullIssue.mockReturnValueOnce('none');
    const h = await harness();

    await expect(h.run()).resolves.toBe('no-mirror');

    // 分类原样上抛：设置页据此显示「尚未生成镜像」而非「已生效」
    expect(h.set).toHaveBeenCalledWith({ mirrorIssue: 'none' });
    expect(h.seededWrite).not.toHaveBeenCalled();
  });

  it('镜像因分块超限拿不到：返回 failed 以阻止首次镜像，同时上报 chunk-limit', async () => {
    mocks.pull.mockResolvedValueOnce(null);
    mocks.pullIssue.mockReturnValueOnce('chunk-limit');
    const h = await harness();

    // 必须 failed 而不是 no-mirror：镜像确实存在（只是读不出来），本地此刻是空态，
    // 一旦按 no-mirror 允许推镜像，云端那份旧设备数据就被空数据覆盖，换机恢复永久失效。
    await expect(h.run()).resolves.toBe('failed');
    expect(h.set).toHaveBeenCalledWith({ mirrorIssue: 'chunk-limit' });
    expect(h.seededWrite).not.toHaveBeenCalled();
  });

  it('镜像损坏 / 过期拿不到：上报 unreadable，与「超出容量上限」区分开', async () => {
    mocks.pull.mockResolvedValueOnce(null);
    mocks.pullIssue.mockReturnValueOnce('unreadable');
    const h = await harness();

    await expect(h.run()).resolves.toBe('no-mirror');
    expect(h.set).toHaveBeenCalledWith({ mirrorIssue: 'unreadable' });
  });

  it('镜像可用：恢复本地并置 seeded，分类为 ok', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [folder('from-mirror')],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    mocks.pullIssue.mockReturnValueOnce('ok');
    const h = await harness();

    await expect(h.run()).resolves.toBe('restored');

    expect(h.set).toHaveBeenCalledWith({ mirrorIssue: 'ok' });
    // 写盘前经 FixedFolderSchema 归一化，故只断言身份而非整对象
    expect(h.foldersWrite).toHaveBeenCalledWith([expect.objectContaining({ id: 'from-mirror' })]);
    expect(h.seededWrite).toHaveBeenCalledWith(true);
  });

  it('镜像形状非法：不恢复、不置 seeded、上报失败（留下次重试机会）', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [{ wrong: 'shape' }],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    mocks.pullIssue.mockReturnValueOnce('ok');
    const h = await harness();

    await expect(h.run()).resolves.toBe('failed');

    expect(h.seededWrite).not.toHaveBeenCalled();
    expect(h.foldersWrite).not.toHaveBeenCalled();
    expect(h.reportPersistenceFailure).toHaveBeenCalled();
    // 镜像读得到但内容非法：状态分类必须降级，否则设置页显示「已生效」
    // 而本地一条都没恢复（pull 的 'ok' 只说明镜像可读）。
    expect(h.set).toHaveBeenLastCalledWith({ mirrorIssue: 'unreadable' });
  });

  it('写盘失败：不置 seeded（否则永久失去重试机会）', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [folder('from-mirror')],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    mocks.pullIssue.mockReturnValueOnce('ok');
    const h = await harness({ foldersWriteOk: false });

    await expect(h.run()).resolves.toBe('failed');

    expect(h.seededWrite).not.toHaveBeenCalled();
    expect(h.reportPersistenceFailure).toHaveBeenCalled();
    // 镜像读到了但一条都没落盘：「已生效」是假象，必须降级状态分类
    expect(h.set).toHaveBeenLastCalledWith({ mirrorIssue: 'unreadable' });
  });

  it('本地已有数据：以本地为准不覆盖，仍置 seeded（换机流程完成）', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [folder('from-mirror')],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    mocks.pullIssue.mockReturnValueOnce('ok');
    const local = [folder('local')];
    const h = await harness({ localFolders: local });

    await expect(h.run()).resolves.toBe('restored');

    // 锁内重读发现本地非空 → 放弃覆盖，不写盘
    expect(h.foldersWrite).not.toHaveBeenCalled();
    expect(h.set).toHaveBeenCalledWith({ folders: local });
    expect(h.seededWrite).toHaveBeenCalledWith(true);
  });
});
