// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 初始化与镜像恢复行为规格：仅在同步开启且本地分区为空时恢复有效镜像；
 * 恢复写入成功后设置 seeded，本地已有数据时以本地内容为准。
 */

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  // 拉取结果分类：默认「从未同步过」（正常空态），用例可改为 'chunk-limit' 等。
  pullIssue: vi.fn(() => 'none' as 'none' | 'ok' | 'chunk-limit' | 'unreadable'),
  applyTheme: vi.fn(),
  readSession: vi.fn(async () => ({ itemTabBindings: {} }))
}));

vi.mock('@/platform/storage/SyncMirror', () => ({
  syncMirror: { pull: mocks.pull, readLastPullIssue: mocks.pullIssue }
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
    readStrict: vi.fn(async () => value),
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
  seededWriteOk?: boolean;
}): Promise<Harness> {
  // 初始化守卫是模块级变量：必须重新导入才能拿到干净的守卫
  vi.resetModules();
  const { createInitSlice } = await import('@/stores/data/initSlice');

  const set = vi.fn();
  const folders = repo(options.folders ?? []);
  const pins = repo(options.pins ?? []);
  const collapse = repo([]);
  const settings = repo(options.settings ?? DEFAULT_SETTINGS);
  const seeded = repo(options.seeded ?? false, options.seededWriteOk ?? true);
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
    setMirrorRestorePending: vi.fn(),
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

  it('镜像因分块超限而不可用：上报具体分类 mirrorIssue（设置页据此提示，而非静默）', async () => {
    // Given 从未同步过之外的原因拿不到镜像（分块数超出浏览器同步配额）
    mocks.pull.mockResolvedValueOnce(null);
    mocks.pullIssue.mockReturnValueOnce('chunk-limit');
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    // When 初始化
    await h.initialized();

    // Then 分类随最终状态一并落地（只进诊断日志时用户完全看不到）
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ mirrorIssue: 'chunk-limit' }));
  });

  it('镜像中形状非法的分区被忽略，不影响其余分区恢复，且不置 seeded（留下次重试）', async () => {
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
    // 单边解析失败不置位：否则该分区永久失去重试机会（与 mirrorRestore 同口径）
    expect(h.seeded.write).not.toHaveBeenCalled();
    // 解析失败必须降级状态分类：pull 只说明「镜像读得到」，而设置页要反映的是
    // 「换机能不能恢复」——沿用 'ok' 会显示「已生效」而本地什么都没恢复。
    expect(applied.mirrorIssue).toBe('unreadable');
  });

  it('镜像磁贴 ID 重复时拒绝整个磁贴分区且不置 seeded', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [],
      pins: [
        { id: 'same', identity: 'a.com', url: 'https://a.com/', title: 'A' },
        { id: 'same', identity: 'b.com', url: 'https://b.com/', title: 'B' }
      ],
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    const applied = h.set.mock.calls[0]![0] as Partial<DataState>;
    expect(applied.pins).toEqual([]);
    expect(applied.mirrorIssue).toBe('unreadable');
    expect(h.seeded.write).not.toHaveBeenCalled();
  });

  /** 镜像恢复的 URL 与 favicon 按外部数据校验规则归一化。 */
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
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    const written = (h.ctx.repos.folders.write as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Array<{ items: Array<Record<string, unknown>> }>;
    expect(written[0]!.items[0]!.url).toBe('about:blank');
    expect(written[0]!.items[1]!.url).toBe('about:blank');
    // 正常条目保留；非白名单 favicon 归一为 undefined（渲染图标会发起外链请求）
    expect(written[0]!.items[2]!.url).toBe('https://ok.com/');
    expect(written[0]!.items[2]!.favIconUrl).toBeUndefined();
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

  it('seeded 写失败时保持恢复待完成并报告镜像未生效', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const h = await harness({
      seeded: false,
      seededWriteOk: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    await h.initialized();

    const applied = h.set.mock.calls[0]![0] as Partial<DataState>;
    expect(applied.mirrorIssue).toBe('unreadable');
    expect(h.reportPersistenceFailure).toHaveBeenCalledWith(
      'dataStore',
      '镜像恢复完成标记写入失败（下次启动重试）'
    );
    expect(h.ctx.setMirrorRestorePending).toHaveBeenCalledWith(true);
    expect(h.ctx.setMirrorRestorePending).not.toHaveBeenCalledWith(false);
  });

  it('镜像写前基线读取故障时中止恢复，不用默认值覆盖', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const h = await harness({
      seeded: false,
      settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });
    h.folders.readStrict.mockRejectedValueOnce(new Error('storage down'));

    await expect(h.initialized()).rejects.toThrow('storage down');

    expect(h.ctx.repos.folders.write).not.toHaveBeenCalled();
    expect(h.seeded.write).not.toHaveBeenCalled();
    expect(h.set).toHaveBeenLastCalledWith({ ready: false });
  });
});
