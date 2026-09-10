// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 初始化切片（`stores/data/initSlice.ts`，此前 29.8%）。
 *
 * 这段逻辑的核心不是「读数据」，而是**首次启动的镜像恢复顺序**，其中三条错了会丢用户数据：
 *
 * 1. **`seeded` 必须在恢复数据全部落盘成功之后才置位**。若先置位而回写失败，
 *    下次启动不再拉取镜像，新设备刚恢复出来的数据永久丢失。
 * 2. **pull 为 null（通道不可用 / 镜像损坏）时同样不置位**，保持下次启动重试的机会。
 * 3. **本地已有数据时以本地为准**（只在对应分区为空时才用镜像值覆盖），
 *    否则老设备会被陈旧镜像反向覆盖。
 *
 * 另有一条与隐私相关的闸门：**「不上传」与「不下载」必须同开同关** ——
 * 关掉同步的用户在换机时不得被旧镜像回灌。
 *
 * 测试方式：直接调用 `createInitSlice(ctx)` 并传入假 ctx，不经 store ——
 * 初始化守卫是模块级变量，因此每个用例都 `resetModules` 后重新导入，
 * 否则第二个用例会被第一个用例的守卫挡掉（表现为「什么都没发生」而假绿）。
 */

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  applyTheme: vi.fn(),
  readSession: vi.fn(async () => ({ itemTabBindings: {} }))
}));

vi.mock('@/platform/storage/SyncMirror', () => ({
  syncMirror: { pull: mocks.pull }
}));

vi.mock('@/platform/theme/ThemeApplier', () => ({
  applyTheme: mocks.applyTheme
}));

vi.mock('@/platform/storage/session', () => ({
  readSession: mocks.readSession
}));

/** 造一个分区仓库替身。 */
function repo<T>(value: T, writeOk = true) {
  return {
    read: vi.fn(async () => value),
    write: vi.fn(async () => writeOk)
  };
}

interface Harness {
  ctx: DataContext;
  set: ReturnType<typeof vi.fn>;
  folders: ReturnType<typeof repo>;
  pins: ReturnType<typeof repo>;
  collapse: ReturnType<typeof repo>;
  settings: ReturnType<typeof repo>;
  seeded: ReturnType<typeof repo>;
  reportPersistenceFailure: ReturnType<typeof vi.fn>;
  initialized: () => Promise<void>;
}

async function harness(options: {
  folders?: unknown[];
  pins?: unknown[];
  settings?: typeof DEFAULT_SETTINGS;
  seeded?: boolean;
  foldersWriteOk?: boolean;
  pinsWriteOk?: boolean;
  settingsWriteOk?: boolean;
}): Promise<Harness> {
  // 初始化守卫是模块级变量：必须重新导入才能拿到干净的守卫
  vi.resetModules();
  const { createInitSlice } = await import('@/stores/data/initSlice');

  const set = vi.fn();
  const folders = repo(options.folders ?? []);
  const pins = repo(options.pins ?? []);
  const collapse = repo([]);
  const settings = repo(options.settings ?? DEFAULT_SETTINGS);
  const seeded = repo(options.seeded ?? false);
  const reportPersistenceFailure = vi.fn();

  const ctx = {
    set,
    get: vi.fn(() => ({}) as DataState),
    repos: {
      folders: { ...folders, write: vi.fn(async () => options.foldersWriteOk ?? true) },
      pins: { ...pins, write: vi.fn(async () => options.pinsWriteOk ?? true) },
      collapse,
      settings: { ...settings, write: vi.fn(async () => options.settingsWriteOk ?? true) },
      seeded
    },
    startSettingsWatcher: vi.fn(),
    startValueWatchers: vi.fn(),
    reportPersistenceFailure
  } as unknown as DataContext;

  const slice = createInitSlice(ctx) as { initialize: () => Promise<void> };
  return {
    ctx,
    set,
    folders,
    pins,
    collapse,
    settings,
    seeded,
    reportPersistenceFailure,
    initialized: () => slice.initialize()
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockResolvedValue({ itemTabBindings: {} });
  mocks.pull.mockResolvedValue(null);
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('常规加载', () => {
  it('读取全部分区并落 ready:true，同时按设置同步主题', async () => {
    mocks.readSession.mockResolvedValue({ itemTabBindings: { 'item-1': 7 } });
    const h = await harness({ seeded: true });

    await h.initialized();

    expect(h.set).toHaveBeenCalledTimes(1);
    const applied = h.set.mock.calls[0]![0] as Partial<DataState>;
    expect(applied.ready).toBe(true);
    expect(applied.boundTabIds).toEqual([7]);
    expect(mocks.applyTheme).toHaveBeenCalledWith(
      DEFAULT_SETTINGS.themePreference,
      DEFAULT_SETTINGS.colorTheme
    );
  });

  it('重复调用只初始化一次（StrictMode 双执行 / 多入口）', async () => {
    const h = await harness({ seeded: true });

    await h.initialized();
    await h.initialized();
    await h.initialized();

    expect(h.set).toHaveBeenCalledTimes(1);
  });

  it('读取失败时回滚守卫、置 ready:false 并抛出（允许上层重试）', async () => {
    const h = await harness({ seeded: true });
    h.folders.read.mockRejectedValueOnce(new Error('storage down'));

    await expect(h.initialized()).rejects.toThrow('storage down');

    expect(h.set).toHaveBeenCalledWith({ ready: false });

    // 守卫已回滚：再次调用应能真正重试（而不是被守卫挡掉导致永久停在骨架屏）
    h.folders.read.mockResolvedValueOnce([]);
    await h.initialized();
    expect((h.set.mock.calls.at(-1)![0] as Partial<DataState>).ready).toBe(true);
  });

  it('固定图标在落库前按身份去重（磁盘里的重复身份会渲染成两块磁贴）', async () => {
    const dup = { id: 'a', identity: 'a.com', url: 'https://a.com/', title: 'A', createdAt: 1 };
    const h = await harness({ seeded: true, pins: [dup, { ...dup, id: 'b' }] });

    await h.initialized();

    const applied = h.set.mock.calls[0]![0] as Partial<DataState>;
    expect(applied.pins).toHaveLength(1);
  });
});

describe('首次启动的镜像恢复', () => {
  const mirror = {
    folders: [
      {
        id: 'f1',
        name: '镜像文件夹',
        collapsed: false,
        createdAt: 1,
        items: []
      }
    ],
    pins: [],
    settings: { ...DEFAULT_SETTINGS, colorTheme: 'violet' }
  };

  it('seeded=true（非新设备）时完全不拉镜像', async () => {
    const h = await harness({ seeded: true });

    await h.initialized();

    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('同步开关关闭时不拉镜像（「不上传」与「不下载」同开同关）', async () => {
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: false }
    });

    await h.initialized();

    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('新设备 + 开关开 + 镜像有效 + 本地为空：恢复三个分区并置 seeded', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    expect(h.ctx.repos.folders.write).toHaveBeenCalled();
    expect(h.ctx.repos.settings.write).toHaveBeenCalled();
    expect(h.seeded.write).toHaveBeenCalledWith(true);
    const applied = h.set.mock.calls[0]![0] as Partial<DataState>;
    expect(applied.folders![0]!.name).toBe('镜像文件夹');
    expect(applied.settings!.colorTheme).toBe('violet');
  });

  it('本地已有数据时以本地为准（不被陈旧镜像反向覆盖）', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const localFolders = [
      { id: 'local', name: '本地文件夹', collapsed: false, createdAt: 2, items: [] }
    ];
    const h = await harness({
      seeded: false,
      folders: localFolders,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    const applied = h.set.mock.calls[0]![0] as Partial<DataState>;
    expect(applied.folders![0]!.name).toBe('本地文件夹');
    // 本地非空 → 不写 folders（避免无谓覆盖）
    expect(h.ctx.repos.folders.write).not.toHaveBeenCalled();
  });

  it('恢复写入失败：留痕且**不置 seeded**（下次启动仍会重试，数据不会永久丢失）', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const h = await harness({
      seeded: false,
      foldersWriteOk: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    expect(h.reportPersistenceFailure).toHaveBeenCalledWith(
      'dataStore',
      '镜像恢复的固定文件夹写入失败'
    );
    expect(h.seeded.write).not.toHaveBeenCalled();
  });

  it('镜像为 null（通道不可用 / 损坏）：不置 seeded，保留下次重试机会', async () => {
    mocks.pull.mockResolvedValueOnce(null);
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    expect(h.seeded.write).not.toHaveBeenCalled();
  });

  it('镜像中形状非法的分区被忽略，不影响其余分区恢复', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [{ wrong: 'shape' }],
      pins: [],
      settings: { ...DEFAULT_SETTINGS, colorTheme: 'violet' }
    });
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    const applied = h.set.mock.calls[0]![0] as Partial<DataState>;
    // 非法 folders 被丢弃，但合法 settings 照常恢复
    expect(applied.folders).toHaveLength(0);
    expect(applied.settings!.colorTheme).toBe('violet');
  });

  it('镜像恢复成功后才置 seeded（顺序：写盘 → 置位）', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    const writeOrder = (h.ctx.repos.settings.write as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const seedOrder = h.seeded.write.mock.invocationCallOrder[0]!;
    expect(writeOrder).toBeLessThan(seedOrder);
  });
});
