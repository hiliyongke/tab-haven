// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, EXPORT_FILE_VERSION } from '@/core/schema/models';
import type { Repositories } from '@/platform/registry';
import type { DataContext, DataState } from '@/stores/data/types';

/**
 * 备份不得携带「禁缓存」开启态（C1）。
 *
 * `noCacheEnabled` 一旦被备份文件打开，`noCachePatterns` 编译出的 DNR 规则立即
 * 生效（platform/background/noCache）。用户此前授予的 `<all_urls>` optional 权限
 * 是给「自己点开的那个开关」用的 —— 备份里的 true 等于绕过这次授权动作，与
 * `syncMirrorEnabled`（导入后把固定 URL 推上浏览器账号通道）同性质：会替用户做出
 * 授权动作的开关一律保留用户当下的选择。
 *
 * 而 `noCachePatterns` **照常导入**：它在 schema 层已归一化（DNR 通配/锚定语法在
 * 解析时被丢弃），开关关闭时完全是零副作用的本地配置。
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
