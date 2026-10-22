// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 首帧主题初始化（`src/theme-init.ts`）。
 *
 * 这个模块必须在 React 渲染前同步跑完（防主题闪烁），所以它：
 *  - 只用 `import type`（运行时 import 有被拆成异步 chunk 的风险）；
 *  - 镜像键与色号白名单**刻意内联**（不能运行时 import 权威来源）——复制由
 *    `theme-mirror-keys.test.ts` 守护对齐。
 *
 * 也因此它长期被覆盖率 exclude 排除：里面有真实分支（存储不可用时的降级、
 * 非法值的回落、system 跟随系统）却从未被执行过。本规格直接驱动这个 IIFE。
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
    // 隐私模式 / 存储被禁用时 getItem 会抛：首帧脚本抛错会让整个入口白屏，
    // 这里必须吞掉并走默认值（这条分支此前因脚本被 exclude 而从未被执行）。
    const stub = installLocalStorage({ [MIRROR_KEY]: 'dark', [HUE_MIRROR_KEY]: 'ocean' });
    stub.failGet = true;
    await expect(runThemeInit()).resolves.toBeUndefined();
    expect(document.documentElement.dataset.themePreference).toBe('system');
    expect(document.documentElement.dataset.hue).toBe('plain');
  });
});
