// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, EXPORT_FILE_VERSION } from '@/core/schema/models';
import type { Repositories } from '@/platform/registry';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 导入事务行为规格：写入失败时回滚已写入的分区；单个分区回滚失败时继续处理其余
 * 分区，并返回可识别的导入失败信息。导入成功后清除过期的镜像状态。
 */

const mocks = vi.hoisted(() => ({
  /** folders 分区已写过（用于把「写」与「回滚」区分开）。 */
  foldersWritten: false,
  /** 让 folders 的**回滚**抛锁异常（模拟回滚途中面板关闭）。 */
  rejectFoldersRollback: false,
  logFailure: vi.fn(),
  logDegraded: vi.fn()
}));

vi.mock('@/platform/storage/crossPageLock', async () => {
  const actual = await vi.importActual<typeof import('@/platform/storage/crossPageLock')>(
    '@/platform/storage/crossPageLock'
  );
  return {
    ...actual,
    withCrossPageLock: (name: string, fn: () => Promise<unknown>) => {
      // 写在前、回滚在后：folders 分区第二次进锁（回滚）时抛出，正是「面板在回滚
      // 途中关闭」的形态。用「已写过」划界而不是按调用序号，避免顺序微调即失效。
      if (name === actual.FOLDERS_RMW_LOCK && mocks.rejectFoldersRollback && mocks.foldersWritten) {
        return Promise.reject(new Error('AbortError: extension context invalidated'));
      }
      return actual.withCrossPageLock(name, fn);
    }
  };
});

vi.mock('@/platform/diagnostics', () => ({
  logFailure: mocks.logFailure,
  logDegraded: mocks.logDegraded
}));

/** 造一个分区仓库替身：read 返回初值，write 返回可配置的成败。 */
function repo<T>(value: T, writeOk = true) {
  return {
    read: vi.fn(async () => value),
    readStrict: vi.fn(async () => value),
    write: vi.fn(async () => writeOk)
  };
}

interface Harness {
  ctx: DataContext;
  set: ReturnType<typeof vi.fn>;
  folders: ReturnType<typeof repo<never[]>>;
  pins: ReturnType<typeof repo<never[]>>;
  collapse: ReturnType<typeof repo<never[]>>;
  settings: ReturnType<typeof repo<typeof DEFAULT_SETTINGS>>;
  snapshots: ReturnType<typeof repo<never[]>>;
  run: (raw: unknown) => Promise<void>;
}

function harness(options: { snapshotsWriteOk?: boolean } = {}): Harness {
  const set = vi.fn();
  const folders = repo([]);
  folders.write.mockImplementation(async () => {
    mocks.foldersWritten = true;
    return true;
  });
  const pins = repo([]);
  const collapse = repo([]);
  const settings = repo(DEFAULT_SETTINGS);
  const snapshots = repo([], options.snapshotsWriteOk ?? true);
  const repos = { folders, pins, collapse, settings, snapshots } as unknown as Repositories;

  const ctx = {
    set,
    get: vi.fn(() => ({}) as DataState),
    repos,
    cancelWrites: vi.fn(async () => undefined),
    scheduleMirror: vi.fn(),
    applyBindings: vi.fn(),
    broadcastSettingsSynced: vi.fn(),
    isImporting: vi.fn(() => false),
    setImporting: vi.fn(),
    isClearing: vi.fn(() => false),
    setClearing: vi.fn(),
    setWatchersSuspended: vi.fn()
  } as unknown as DataContext;

  return {
    ctx,
    set,
    folders,
    pins,
    collapse,
    settings,
    snapshots,
    run: async (raw) => {
      const { createTransferSlice } = await import('@/stores/data/transferSlice');
      const slice = createTransferSlice(ctx) as { importData: (raw: unknown) => Promise<void> };
      await slice.importData(raw);
    }
  };
}

const payload = {
  format: 'tabs.export',
  version: EXPORT_FILE_VERSION,
  exportedAt: new Date().toISOString(),
  fixedFolders: [
    {
      id: 'f1',
      name: '导入的文件夹',
      collapsed: false,
      createdAt: 1,
      items: [{ id: 'i1', url: 'https://a.com/', title: 'A', createdAt: 1 }]
    }
  ],
  persistentPins: [],
  siteCollapse: [],
  settings: DEFAULT_SETTINGS,
  snapshots: []
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.foldersWritten = false;
  mocks.rejectFoldersRollback = false;
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('导入事务的回滚链', () => {
  it('最后一个分区写失败时回滚已写入的分区', async () => {
    const h = await harness({ snapshotsWriteOk: false });

    await expect(h.run(payload)).rejects.toThrow('import-write-failed:snapshots');

    // 已写入的四个分区都被还原（直写回滚前的磁盘值）
    expect(h.folders.write).toHaveBeenLastCalledWith([]);
    expect(h.pins.write).toHaveBeenLastCalledWith([]);
    expect(h.collapse.write).toHaveBeenLastCalledWith([]);
    expect(h.settings.write).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
  });

  it('某个分区的回滚抛锁异常：循环继续，抛出仍是 import-write-failed 且失败分区被记录', async () => {
    mocks.rejectFoldersRollback = true;
    const h = await harness({ snapshotsWriteOk: false });

    // 抛出的必须是导入语义错误，不是锁错误（UI 据此给出可解释的提示）
    const error: unknown = await h.run(payload).catch((reason: unknown) => reason);
    const { ImportDataError } = await import('@/stores/data/transferSlice');
    expect(error).toBeInstanceOf(ImportDataError);
    if (error instanceof ImportDataError) {
      expect(error.partition).toBe('snapshots');
      expect(error.rollbackFailures).toEqual(['folders']);
    }

    // 回滚链没有在第一个分区处中断：其余分区照样尝试回滚
    expect(h.pins.write).toHaveBeenLastCalledWith([]);
    expect(h.collapse.write).toHaveBeenLastCalledWith([]);
    expect(h.settings.write).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
    // 失败的分区名必须留痕（否则排查时只知道「回滚了」，不知道哪个没回滚成）
    const rollbackLogged = mocks.logFailure.mock.calls.some(
      (call) =>
        typeof call[1] === 'string' &&
        call[1].includes('导入回滚失败') &&
        call[1].includes('folders')
    );
    expect(rollbackLogged).toBe(true);
  });
});

describe('导入前基线读取', () => {
  it('任一分区 readStrict 故障时不写任何分区并释放事务标志', async () => {
    const h = await harness();
    h.pins.readStrict.mockRejectedValueOnce(new Error('storage down'));

    await expect(h.run(payload)).rejects.toThrow('storage down');

    for (const repo of [h.folders, h.pins, h.collapse, h.settings, h.snapshots]) {
      expect(repo.write).not.toHaveBeenCalled();
    }
    expect(h.ctx.setImporting).toHaveBeenLastCalledWith(false);
    expect(h.ctx.setWatchersSuspended).toHaveBeenLastCalledWith(false);
  });
});

describe('导入成功后的镜像状态', () => {
  it('整表替换 folders/pins 后清除 mirrorIssue', async () => {
    const h = await harness();

    await h.run(payload);

    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ mirrorIssue: null }));
  });
});
