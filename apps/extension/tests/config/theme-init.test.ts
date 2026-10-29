// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 首帧主题初始化行为规格：根据存储值与系统偏好设置主题、偏好和色号；
 * 存储不可用或值无效时使用对应默认值。
 */

const MIRROR_KEY = 'tabs:theme';
const HUE_MIRROR_KEY = 'tabs:theme-hue';

interface StorageStub {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  failGet: boolean;
}

/**
 * jsdom 在本项目的测试环境里没有可用的 localStorage（origin 未配置时会是
 * undefined），而首帧脚本依赖它。这里给一份内存实现，顺便把「存储不可用」
 * 这条降级路径做成可开关。
 */
function installLocalStorage(initial: Record<string, string> = {}): StorageStub {
  const stub: StorageStub = {
    store: { ...initial },
    failGet: false,
    getItem(key: string): string | null {
      if (stub.failGet) throw new Error('localStorage disabled');
      return stub.store[key] ?? null;
    }
  };
  Object.defineProperty(window, 'localStorage', {
    value: { getItem: (key: string) => stub.getItem(key) },
    configurable: true,
    writable: true
  });
  return stub;
}

/** 重新执行 IIFE（模块副作用只在首次 import 时发生，故每次都要重置模块表）。 */
async function runThemeInit(): Promise<void> {
  vi.resetModules();
  await import('@/theme-init');
}

function stubSystemPrefersDark(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') ? matches : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })) as unknown as typeof window.matchMedia;
}

describe('theme-init', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.removeAttribute('data-hue');
    stubSystemPrefersDark(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('无存储：跟随系统（亮）', async () => {
    installLocalStorage();
    await runThemeInit();
    expect(document.documentElement.dataset.themePreference).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('无存储且系统为暗：解析为 dark 但 preference 仍记 system', async () => {
    installLocalStorage();
    stubSystemPrefersDark(true);
    await runThemeInit();
    expect(document.documentElement.dataset.themePreference).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('存储 dark：不跟随系统', async () => {
    installLocalStorage({ [MIRROR_KEY]: 'dark' });
    stubSystemPrefersDark(false);
    await runThemeInit();
    expect(document.documentElement.dataset.themePreference).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('存储值非法：回落 system（不把脏值写进 DOM）', async () => {
    installLocalStorage({ [MIRROR_KEY]: 'DARK' });
    await runThemeInit();
    expect(document.documentElement.dataset.themePreference).toBe('system');
  });

  it('色号不在白名单：回落 plain', async () => {
    installLocalStorage({ [HUE_MIRROR_KEY]: 'not-a-hue' });
    await runThemeInit();
    expect(document.documentElement.dataset.hue).toBe('plain');
  });

  it('色号合法：原样应用', async () => {
    installLocalStorage({ [HUE_MIRROR_KEY]: 'ocean' });
    await runThemeInit();
    expect(document.documentElement.dataset.hue).toBe('ocean');
  });

  it('页面级存储不可用：降级为跟随系统，不抛错', async () => {
    // 存储读取失败时使用 system 偏好与默认色号，且初始化不抛错。
    const stub = installLocalStorage({ [MIRROR_KEY]: 'dark', [HUE_MIRROR_KEY]: 'ocean' });
    stub.failGet = true;
    await expect(runThemeInit()).resolves.toBeUndefined();
    expect(document.documentElement.dataset.themePreference).toBe('system');
    expect(document.documentElement.dataset.hue).toBe('plain');
  });
});
