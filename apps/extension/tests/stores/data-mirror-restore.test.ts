// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 开启同步时的镜像恢复行为规格：已有本地数据时不覆盖；未能读取或写入有效镜像时
 * 不设置 seeded，并将镜像状态分类交给 store；恢复成功后更新本地数据并设置 seeded。
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
    seededWriteOk?: boolean;
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
  const seededWrite = vi.fn(async () => options.seededWriteOk ?? true);
  const reportPersistenceFailure = vi.fn();

  const ctx = {
    set,
    get,
    repos: {
      seeded: {
        read: vi.fn(async () => options.seeded ?? false),
        readStrict: vi.fn(async () => options.seeded ?? false),
        write: seededWrite
      },
      folders: {
        read: vi.fn(async () => options.localFolders ?? []),
        readStrict: vi.fn(async () => options.localFolders ?? []),
        write: foldersWrite
      },
      pins: {
        read: vi.fn(async () => options.localPins ?? []),
        readStrict: vi.fn(async () => options.localPins ?? []),
        write: pinsWrite
      }
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
  it('已 seeded 时不拉取镜像，以本地数据为准', async () => {
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

    // 镜像存在但不可读时保持未 seeded，并保留 chunk-limit 分类。
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
    // 恢复后持久化的文件夹保留原有身份。
    expect(h.foldersWrite).toHaveBeenCalledWith([expect.objectContaining({ id: 'from-mirror' })]);
    expect(h.seededWrite).toHaveBeenCalledWith(true);
  });

  it('镜像内容非法时不恢复、不置 seeded 并报告失败', async () => {
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
    // 镜像内容非法时，状态分类为 unreadable。
    expect(h.set).toHaveBeenLastCalledWith({ mirrorIssue: 'unreadable' });
  });

  it('本地写入失败时保持未 seeded 并报告失败', async () => {
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
    // 没有数据成功落盘时，状态分类为 unreadable。
    expect(h.set).toHaveBeenLastCalledWith({ mirrorIssue: 'unreadable' });
  });

  it('seeded 写失败时返回 failed，不把恢复当成功', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [folder('from-mirror')],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    const h = await harness({ seededWriteOk: false });

    await expect(h.run()).resolves.toBe('failed');

    expect(h.seededWrite).toHaveBeenCalledWith(true);
    expect(h.reportPersistenceFailure).toHaveBeenCalledWith(
      'dataStore',
      '镜像恢复完成标记写入失败（下次启动重试）'
    );
    expect(h.set).toHaveBeenLastCalledWith({ mirrorIssue: 'unreadable' });
  });

  it('锁内基线读取故障时中止，不写 folders/pins 或 seeded', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [folder('from-mirror')],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    const h = await harness();
    vi.spyOn(h.ctx.repos.folders, 'readStrict').mockRejectedValue(new Error('storage down'));

    await expect(h.run()).rejects.toThrow('storage down');

    expect(h.foldersWrite).not.toHaveBeenCalled();
    expect(h.pinsWrite).not.toHaveBeenCalled();
    expect(h.seededWrite).not.toHaveBeenCalled();
  });

  /** 镜像恢复时按备份导入使用的规则校验和归一化 URL 与 favicon。 */
  it('镜像条目 url 为脚本 / 本地文件时归一为 about:blank（与备份入口同口径）', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [
        {
          id: 'f1',
          name: '镜像文件夹',
          collapsed: false,
          createdAt: 1,
          items: [
            { id: 'i1', url: 'javascript:alert(1)', title: 'XSS', createdAt: 1 },
            { id: 'i2', url: 'file:///etc/passwd', title: '本地文件', createdAt: 1 },
            {
              id: 'i3',
              url: 'https://ok.com/',
              title: '正常',
              favIconUrl: 'https://tracker.example/pixel.png',
              createdAt: 1
            }
          ]
        }
      ],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    mocks.pullIssue.mockReturnValueOnce('ok');
    const h = await harness();

    await expect(h.run()).resolves.toBe('restored');

    const written = h.foldersWrite.mock.calls[0]![0] as Array<{
      items: Array<Record<string, unknown>>;
    }>;
    expect(written[0]!.items[0]!.url).toBe('about:blank');
    expect(written[0]!.items[1]!.url).toBe('about:blank');
    // 正常条目不受影响；非白名单的 favicon 归一为 undefined（不触发外链请求）
    expect(written[0]!.items[2]!.url).toBe('https://ok.com/');
    expect(written[0]!.items[2]!.favIconUrl).toBeUndefined();
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

    // 本地数据已有内容时，保留本地内容且不写盘。
    expect(h.foldersWrite).not.toHaveBeenCalled();
    expect(h.set).toHaveBeenCalledWith({ folders: local });
    expect(h.seededWrite).toHaveBeenCalledWith(true);
  });
});
