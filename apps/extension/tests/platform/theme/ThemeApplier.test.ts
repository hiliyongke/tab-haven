// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, watchSystemTheme } from '@/platform/theme/ThemeApplier';

/**
 * 主题三态的应用（`platform/theme/ThemeApplier`）。
 *
 * 为什么单独建这个文件：主题是**首帧可见**的东西，而它此前没有独立测试 —— 目录均值
 * 阈值下（platform 子目录整体 82%）它塌到 0% 也不会触发门禁。
 *
 * 要钉死的三件事：
 *  1. 三态解析：system 跟随系统、light/dark 直出；
 *  2. 镜像落盘：`tabs:theme` / `tabs:theme-hue` 必须与 `theme-init` 的读取键一致
 *     （键名一致性另由 tests/config/theme-mirror-keys.test.ts 守护）；
 *  3. 降级：localStorage 不可用/写入失败都不能让设置页崩掉 —— 主题是装饰性的，
 *     绝不能变成致命路径。
 */

/**
 * jsdom 在本项目的测试环境里没有可用的 localStorage（origin 未配置），故自行安装
 * 一份内存实现；`failGet` / `failSet` 用来驱动两条降级分支。
 */
interface StorageStub {
  store: Record<string, string>;
  failGet: boolean;
  failSet: boolean;
  setItem: (key: string, value: string) => void;
}

function installLocalStorage(initial: Record<string, string> = {}): StorageStub {
  const stub: StorageStub = {
    store: { ...initial },
    failGet: false,
    failSet: false,
    setItem(key: string, value: string): void {
      if (stub.failSet) throw new Error('QuotaExceededError');
      stub.store[key] = value;
    }
  };
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string): string | null => {
        if (stub.failGet) throw new Error('localStorage disabled');
        return stub.store[key] ?? null;
      },
      setItem: (key: string, value: string) => stub.setItem(key, value)
    },
    configurable: true,
    writable: true
  });
  return stub;
}

/** 安装可控的 matchMedia：按 query 返回预设结果，并记录注册/注销。 */
function stubMatchMedia(matches: Record<string, boolean>) {
  const listeners = new Map<string, ((event: { matches: boolean }) => void)[]>();
  window.matchMedia = ((query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
      const list = listeners.get(query) ?? [];
      list.push(fn);
      listeners.set(query, list);
    },
    removeEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
      listeners.set(
        query,
        (listeners.get(query) ?? []).filter((item) => item !== fn)
      );
    },
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
  return {
    emit(query: string, value: boolean) {
      for (const fn of listeners.get(query) ?? []) fn({ matches: value });
    },
    count(query: string) {
      return (listeners.get(query) ?? []).length;
    }
  };
}

const root = () => document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
  installLocalStorage();
  root().dataset.theme = '';
  root().dataset.themePreference = '';
  root().dataset.hue = '';
  root().classList.remove('theme-transition');
  stubMatchMedia({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('applyTheme 三态解析', () => {
  it('Given system 且系统为深色 When 应用 Then data-theme=dark 且 preference 保留 system', () => {
    stubMatchMedia({ '(prefers-color-scheme: dark)': true });

    applyTheme('system');

    expect(root().dataset.theme).toBe('dark');
    // preference 与 resolved 必须分开存：写回设置时要用 preference（否则 system 一旦
    // 解析成 dark 就被固化成 dark，用户再改系统配色也不跟随了）。
    expect(root().dataset.themePreference).toBe('system');
  });

  it('Given system 且系统为浅色 When 应用 Then data-theme=light', () => {
    stubMatchMedia({ '(prefers-color-scheme: dark)': false });

    applyTheme('system');

    expect(root().dataset.theme).toBe('light');
  });

  it('Given 显式 light When 应用 Then 压过系统深色（显式偏好优先）', () => {
    stubMatchMedia({ '(prefers-color-scheme: dark)': true });

    applyTheme('light');

    expect(root().dataset.theme).toBe('light');
    expect(root().dataset.themePreference).toBe('light');
  });
});

describe('applyTheme 的镜像落盘', () => {
  it('落盘 tabs:theme 与 tabs:theme-hue（theme-init 首帧读的就是这两条）', () => {
    const storage = installLocalStorage();

    applyTheme('dark', 'ocean');

    expect(storage.store['tabs:theme']).toBe('dark');
    expect(storage.store['tabs:theme-hue']).toBe('ocean');
    expect(root().dataset.hue).toBe('ocean');
  });

  it('默认色号为 plain（不传色号时不写空值）', () => {
    const storage = installLocalStorage();

    applyTheme('light');

    expect(storage.store['tabs:theme-hue']).toBe('plain');
  });

  it('值未变时不重复写入（localStorage 是同步 API，每次设置变更都写两次会阻塞主线程）', () => {
    const storage = installLocalStorage({ 'tabs:theme': 'dark', 'tabs:theme-hue': 'ocean' });
    const before = { ...storage.store };

    applyTheme('dark', 'ocean');

    expect(storage.store).toEqual(before);
  });
});

describe('applyTheme 的降级', () => {
  it('localStorage 读取失败时只影响防闪烁，仍要把主题应用到 DOM', () => {
    const storage = installLocalStorage();
    storage.failGet = true;

    expect(() => applyTheme('dark')).not.toThrow();
    expect(root().dataset.theme).toBe('dark');
  });

  it('localStorage 写入失败（配额超限）时同样不影响 DOM 应用', () => {
    const storage = installLocalStorage();
    storage.failSet = true;

    expect(() => applyTheme('dark', 'forest')).not.toThrow();
    expect(root().dataset.theme).toBe('dark');
    expect(root().dataset.hue).toBe('forest');
  });
});

describe('主题切换的平滑过渡', () => {
  it('明暗真的变化时才挂过渡类，并在 220ms 后摘掉', () => {
    applyTheme('light');

    expect(root().classList.contains('theme-transition')).toBe(true);

    vi.advanceTimersByTime(220);

    expect(root().classList.contains('theme-transition')).toBe(false);
  });

  it('reduced-motion 用户跳过过渡（尊重系统的减少动效设置）', () => {
    stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });

    applyTheme('light');

    expect(root().classList.contains('theme-transition')).toBe(false);
  });

  it('值未变时不触发过渡（首帧 theme-init 已写过相同值）', () => {
    applyTheme('light');
    root().classList.remove('theme-transition');

    applyTheme('light');

    expect(root().classList.contains('theme-transition')).toBe(false);
  });
});

describe('matchMedia 缺失时的降级', () => {
  /** 移除 window.matchMedia（模拟不支持媒体查询的宿主环境）。 */
  const removeMatchMedia = (): void => {
    Object.defineProperty(window, 'matchMedia', {
      value: undefined,
      configurable: true,
      writable: true
    });
  };

  it('Given 无 matchMedia 且偏好 system When 应用 Then 不抛且落到兜底浅色', () => {
    removeMatchMedia();

    expect(() => applyTheme('system')).not.toThrow();
    expect(root().dataset.theme).toBe('light');
    // preference 仍是 system：探测能力缺失不改写用户的选择
    expect(root().dataset.themePreference).toBe('system');
  });

  it('Given 无 matchMedia When 应用显式深色 Then 照常生效（不需要探测）', () => {
    removeMatchMedia();

    expect(() => applyTheme('dark')).not.toThrow();
    expect(root().dataset.theme).toBe('dark');
  });

  it('Given matchMedia 调用即抛 When 应用 Then 同样降级不抛', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: () => {
        throw new Error('matchMedia disabled');
      },
      configurable: true,
      writable: true
    });

    expect(() => applyTheme('system')).not.toThrow();
    expect(root().dataset.theme).toBe('light');
  });

  it('Given 无 matchMedia When 订阅系统配色 Then 返回可用的注销函数且不抛', () => {
    removeMatchMedia();

    const stop = watchSystemTheme(() => undefined);
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});

describe('watchSystemTheme', () => {
  it('系统配色变化时回调，取消订阅后不再回调', () => {
    const media = stubMatchMedia({ '(prefers-color-scheme: dark)': false });
    const onChange = vi.fn();

    const stop = watchSystemTheme(onChange);
    media.emit('(prefers-color-scheme: dark)', true);
    expect(onChange).toHaveBeenCalledWith(true);

    stop();
    media.emit('(prefers-color-scheme: dark)', false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(media.count('(prefers-color-scheme: dark)')).toBe(0);
  });
});
