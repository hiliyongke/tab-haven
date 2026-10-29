// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, EXPORT_FILE_VERSION } from '@/core/schema/models';
import type { Repositories } from '@/platform/registry';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 导入备份时，禁缓存开关保留本地当前值；禁缓存站点列表按备份内容导入。
 */

function repo<T>(value: T) {
  /** 历次 write 的入参（最后一条即落盘终值）。 */
  const writes: T[] = [];
  return {
    writes,
    read: vi.fn(async (): Promise<T> => value),
    write: vi.fn(async (next: T): Promise<boolean> => {
      writes.push(next);
      return true;
    })
  };
}

interface Harness {
  ctx: DataContext;
  set: ReturnType<typeof vi.fn>;
  settings: ReturnType<typeof repo<typeof DEFAULT_SETTINGS>>;
  run: (raw: unknown) => Promise<void>;
}

function harness(): Harness {
  const set = vi.fn();
  const folders = repo([]);
  const pins = repo([]);
  const collapse = repo([]);
  // 用户当下：开关关闭（DEFAULT_SETTINGS 默认即 false）
  const settings = repo<typeof DEFAULT_SETTINGS>({
    ...DEFAULT_SETTINGS,
    noCacheEnabled: false,
    noCachePatterns: []
  });
  const snapshots = repo([]);
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
    settings,
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
  fixedFolders: [],
  persistentPins: [],
  siteCollapse: [],
  // 构造的备份：开关为 true，并带一份合法站点列表
  settings: { ...DEFAULT_SETTINGS, noCacheEnabled: true, noCachePatterns: ['a.com', 'b.com/app'] },
  snapshots: []
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('导入备份时的禁缓存口径', () => {
  it('备份里的 noCacheEnabled:true 不生效（开关保持用户当下的关闭态）', async () => {
    const h = harness();

    await h.run(payload);

    const written = h.settings.writes.at(-1);
    expect(written?.noCacheEnabled).toBe(false);
    // 内存态同步（UI 据此渲染开关）
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ settings: written }));
  });

  it('noCachePatterns 照常导入（开关关闭时它只是零副作用的本地配置）', async () => {
    const h = harness();

    await h.run(payload);

    const written = h.settings.writes.at(-1);
    expect(written?.noCachePatterns).toEqual(['a.com', 'b.com/app']);
  });

  it('用户已开启时导入不会把它关掉（只挡「备份打开」，不反向关掉用户的选择）', async () => {
    const h = harness();
    h.settings.read.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      noCacheEnabled: true,
      noCachePatterns: ['mine.com']
    });

    await h.run({ ...payload, settings: { ...DEFAULT_SETTINGS, noCacheEnabled: false } });

    const written = h.settings.writes.at(-1);
    expect(written?.noCacheEnabled).toBe(true);
  });
});
