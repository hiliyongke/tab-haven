// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 设置切片（`stores/data/settingsSlice.ts`）的同步镜像时序规格。
 *
 * 核心风险（曾是把用户数据搞丢的链路）：
 *
 * 1. **新设备开启同步时必须「先恢复、后镜像」**。新设备本地设置是默认值
 *    （syncMirrorEnabled=false），初始化的镜像拉取分支不会命中；若开启同步后
 *    直接把本地空态推上云，旧设备留下的镜像会被空数据覆盖——换机恢复不可用，
 *    且云端副本被销毁。
 * 2. **关闭同步时 clearAll 必须被 await**：调用方返回时云端数据已确认删除，
 *    与 resetSettings 同口径。
 */

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  clearAll: vi.fn(async () => {}),
  schedule: vi.fn(),
  applyTheme: vi.fn()
}));

vi.mock('@/platform/storage/SyncMirror', () => ({
  syncMirror: { pull: mocks.pull, clearAll: mocks.clearAll, schedule: mocks.schedule }
}));

vi.mock('@/platform/theme/ThemeApplier', () => ({
  applyTheme: mocks.applyTheme
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
  state: Partial<DataState>;
  folders: ReturnType<typeof repo>;
  pins: ReturnType<typeof repo>;
  seeded: ReturnType<typeof repo>;
  scheduleMirror: ReturnType<typeof vi.fn>;
  reportPersistenceFailure: ReturnType<typeof vi.fn>;
  updateSettings: (partial: Partial<typeof DEFAULT_SETTINGS>) => Promise<void>;
}

async function harness(options: {
  folders?: unknown[];
  pins?: unknown[];
  diskSettings?: typeof DEFAULT_SETTINGS;
  seeded?: boolean;
  foldersWriteOk?: boolean;
}): Promise<Harness> {
  const { createSettingsSlice } = await import('@/stores/data/settingsSlice');

  const state: Partial<DataState> = {
    folders: (options.folders ?? []) as DataState['folders'],
    pins: (options.pins ?? []) as DataState['pins'],
    settings: options.diskSettings ?? DEFAULT_SETTINGS
  };
  const folders = repo(options.folders ?? [], options.foldersWriteOk ?? true);
  const pins = repo(options.pins ?? []);
  const seeded = repo(options.seeded ?? false);
  const scheduleMirror = vi.fn();
  const reportPersistenceFailure = vi.fn();

  const ctx = {
    set: vi.fn((partial: Partial<DataState>) => Object.assign(state, partial)),
    get: vi.fn(() => state as DataState),
    repos: {
      folders,
      pins,
      settings: repo(options.diskSettings ?? DEFAULT_SETTINGS),
      seeded
    },
    scheduleMirror,
    broadcastSettingsSynced: vi.fn(),
    reportPersistenceFailure
  } as unknown as DataContext;

  const slice = createSettingsSlice(ctx) as {
    updateSettings: (partial: Partial<typeof DEFAULT_SETTINGS>) => Promise<void>;
  };
  return {
    ctx,
    state,
    folders,
    pins,
    seeded,
    scheduleMirror,
    reportPersistenceFailure,
    updateSettings: slice.updateSettings
  };
}

// 注意：schema 会剥掉未声明的字段（如 createdAt），fixture 只保留 schema 字段。
const mirror = {
  folders: [{ id: 'f1', name: '镜像文件夹', collapsed: false, items: [] }],
  pins: [{ id: 'p1', identity: 'a.com', url: 'https://a.com/', title: 'A' }],
  settings: { ...DEFAULT_SETTINGS, colorTheme: 'violet' }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pull.mockResolvedValue(null);
  mocks.clearAll.mockResolvedValue(undefined);
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('开启同步的反向恢复（新设备换机恢复）', () => {
  it('未 seeded + 镜像有效 + 本地为空：先恢复落盘并置 seeded，再做首次镜像', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const h = await harness({ seeded: false });

    await h.updateSettings({ syncMirrorEnabled: true });

    // 恢复：镜像数据写入本地分区并进入内存
    expect(h.folders.write).toHaveBeenCalledWith(mirror.folders);
    expect(h.pins.write).toHaveBeenCalledWith(mirror.pins);
    expect(h.state.folders).toEqual(mirror.folders);
    expect(h.seeded.write).toHaveBeenCalledWith(true);
    // 镜像必须在恢复之后调度（否则空态先上云覆盖旧镜像）
    expect(h.scheduleMirror).toHaveBeenCalledTimes(1);
    const restoreOrder = (h.folders.write as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const mirrorOrder = h.scheduleMirror.mock.invocationCallOrder[0]!;
    expect(restoreOrder).toBeLessThan(mirrorOrder);
  });

  it('已 seeded（老设备重新开启）：不拉镜像，直接镜像本地数据', async () => {
    const h = await harness({ seeded: true, folders: mirror.folders });

    await h.updateSettings({ syncMirrorEnabled: true });

    expect(mocks.pull).not.toHaveBeenCalled();
    expect(h.seeded.write).not.toHaveBeenCalled();
    expect(h.scheduleMirror).toHaveBeenCalledTimes(1);
  });

  it('本地已有数据：以本地为准，不写分区但仍置 seeded', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const localFolders = [
      { id: 'local', name: '本地文件夹', collapsed: false, createdAt: 2, items: [] }
    ];
    const h = await harness({ seeded: false, folders: localFolders });

    await h.updateSettings({ syncMirrorEnabled: true });

    expect(h.folders.write).not.toHaveBeenCalled();
    expect(h.state.folders).toEqual(localFolders);
    expect(h.seeded.write).toHaveBeenCalledWith(true);
  });

  it('镜像为 null（从未同步过 / 损坏）：不置 seeded，直接把当前本地态做成首份镜像', async () => {
    mocks.pull.mockResolvedValueOnce(null);
    const h = await harness({ seeded: false });

    await h.updateSettings({ syncMirrorEnabled: true });

    expect(h.folders.write).not.toHaveBeenCalled();
    expect(h.seeded.write).not.toHaveBeenCalled();
    expect(h.scheduleMirror).toHaveBeenCalledTimes(1);
  });

  it('恢复写盘失败：不推首次镜像（空态上云会覆盖旧设备镜像）且不置 seeded', async () => {
    mocks.pull.mockResolvedValueOnce(mirror);
    const h = await harness({ seeded: false, foldersWriteOk: false });

    await h.updateSettings({ syncMirrorEnabled: true });

    expect(h.reportPersistenceFailure).toHaveBeenCalledWith(
      'dataStore',
      '镜像恢复的固定文件夹写入失败'
    );
    expect(h.scheduleMirror).not.toHaveBeenCalled();
    expect(h.seeded.write).not.toHaveBeenCalled();
  });

  it('镜像单边解析失败（schema 偏斜）：不推首次镜像且不置 seeded（留下次启动重试）', async () => {
    mocks.pull.mockResolvedValueOnce({
      folders: [{ wrong: 'shape' }],
      pins: [],
      settings: { ...DEFAULT_SETTINGS }
    });
    const h = await harness({ seeded: false });

    await h.updateSettings({ syncMirrorEnabled: true });

    expect(h.scheduleMirror).not.toHaveBeenCalled();
    expect(h.seeded.write).not.toHaveBeenCalled();
  });
});

describe('关闭同步', () => {
  it('clearAll 被 await：云端数据确认删除后 updateSettings 才返回', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.clearAll.mockImplementationOnce(() => gate);
    const h = await harness({
      seeded: true,
      diskSettings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: true }
    });

    let settled = false;
    const pending = h.updateSettings({ syncMirrorEnabled: false }).then(() => {
      settled = true;
    });

    // 让锁内流程推进到 clearAll
    await vi.waitFor(() => expect(mocks.clearAll).toHaveBeenCalled());
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await pending;
    expect(settled).toBe(true);
  });
});
