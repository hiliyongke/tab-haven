// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type FixedFolder, type Settings } from '@/core/schema/models';
import type { Repositories } from '@/platform/registry';
import type { DataState } from '@/stores/data/types';

/** 初始化与设置回放的 latest-write-wins 行为规格。 */
const mocks = vi.hoisted(() => ({
  applyTheme: vi.fn(),
  readSession: vi.fn(async () => ({ itemTabBindings: {} })),
  pull: vi.fn(async () => null)
}));

vi.mock('@/platform/theme/ThemeApplier', () => ({ applyTheme: mocks.applyTheme }));
vi.mock('@/platform/storage/session', () => ({ readSession: mocks.readSession }));
vi.mock('@/platform/storage/SyncMirror', () => ({
  syncMirror: {
    setMirrorResultHandlers: vi.fn(),
    schedule: vi.fn(),
    pull: mocks.pull,
    readLastPullIssue: vi.fn(() => 'none')
  }
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function initialState(): DataState {
  const state: Partial<DataState> = {
    folders: [],
    pins: [],
    collapsedSites: [],
    settings: DEFAULT_SETTINGS,
    boundTabIds: [],
    storageDegraded: false,
    mirrorIssue: null,
    mirrorWriteFailed: false,
    mirrorQuotaExceeded: false,
    importing: false,
    ready: false
  };
  return state as DataState;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('初始化旧读守卫', () => {
  it('folders read 在途期间 watcher 回放新值时，最终保留新值', async () => {
    vi.resetModules();
    const [{ buildDataContext }, { createInitSlice }] = await Promise.all([
      import('@/stores/data/context'),
      import('@/stores/data/initSlice')
    ]);
    const state = initialState();
    const oldRead = deferred<FixedFolder[]>();
    let folderWatch: ((value: FixedFolder[]) => void) | undefined;
    const immediateRepo = <T>(value: T) => ({
      read: vi.fn(async () => value),
      readStrict: vi.fn(async () => value),
      write: vi.fn(async () => true),
      watch: vi.fn(() => () => undefined)
    });
    const repos = {
      folders: {
        read: vi.fn(() => oldRead.promise),
        readStrict: vi.fn(async () => []),
        write: vi.fn(async () => true),
        watch: vi.fn((onChange: (value: FixedFolder[]) => void) => {
          folderWatch = onChange;
          return () => undefined;
        })
      },
      pins: immediateRepo([]),
      collapse: immediateRepo([]),
      settings: immediateRepo(DEFAULT_SETTINGS),
      seeded: immediateRepo(true)
    } as unknown as Repositories;
    const ctx = buildDataContext(
      (partial) => Object.assign(state, partial),
      () => state,
      repos
    );

    const pending = createInitSlice(ctx).initialize();
    await vi.waitFor(() => expect(repos.folders.read).toHaveBeenCalled());
    const latest: FixedFolder[] = [{ id: 'new', name: '新文件夹', collapsed: false, items: [] }];
    folderWatch?.(latest);
    oldRead.resolve([]);
    await pending;

    expect(state.folders).toEqual(latest);
  });
});

describe('设置回读旧值守卫', () => {
  it('旧 read 晚于 watch 新值完成时，不覆盖新设置与主题', async () => {
    const { buildDataContext } = await import('@/stores/data/context');
    const state = initialState();
    const oldRead = deferred<Settings>();
    let settingsWatch: ((value: Settings) => void) | undefined;
    const immediateRepo = <T>(value: T) => ({
      read: vi.fn(async () => value),
      readStrict: vi.fn(async () => value),
      write: vi.fn(async () => true),
      watch: vi.fn(() => () => undefined)
    });
    const repos = {
      folders: immediateRepo([]),
      pins: immediateRepo([]),
      collapse: immediateRepo([]),
      settings: {
        read: vi.fn(() => oldRead.promise),
        readStrict: vi.fn(async () => DEFAULT_SETTINGS),
        write: vi.fn(async () => true),
        watch: vi.fn((onChange: (value: Settings) => void) => {
          settingsWatch = onChange;
          return () => undefined;
        })
      },
      seeded: immediateRepo(true)
    } as unknown as Repositories;
    const ctx = buildDataContext(
      (partial) => Object.assign(state, partial),
      () => state,
      repos
    );
    ctx.startSettingsWatcher();
    const pending = ctx.syncSettingsFromStorage();
    await vi.waitFor(() => expect(repos.settings.read).toHaveBeenCalled());

    const latest: Settings = { ...DEFAULT_SETTINGS, colorTheme: 'violet' };
    settingsWatch?.(latest);
    oldRead.resolve(DEFAULT_SETTINGS);
    await pending;

    expect(state.settings).toEqual(latest);
    expect(mocks.applyTheme).toHaveBeenLastCalledWith(latest.themePreference, latest.colorTheme);
  });
});
