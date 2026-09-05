/**
 * 主题初始化（在 React 渲染前执行，防闪烁）。
 *
 * 从页面级存储的镜像键同步读取主题偏好并立即设置 documentElement 数据属性。
 * 权威设置在 chrome.storage（异步），本模块只读同步可用的镜像以避免首屏闪烁。
 *
 * 调用约定：各入口 main.tsx 的首个 import。
 *
 * 只用 `import type`（编译期擦除）：本脚本必须同步执行完才能防住首屏闪烁，
 * 引入任何运行时模块都有被拆成异步 chunk 的风险。
 */
import type { ColorTheme } from '@/core/theme/colorThemes';

(() => {
  const MIRROR_KEY = 'tabs:theme';
  const HUE_MIRROR_KEY = 'tabs:theme-hue';

  type ThemePreference = 'system' | 'light' | 'dark';
  /**
   * 色号白名单。因上述原因不能运行时 import 权威色板，故此处内联；
   * 用 `Record<ColorTheme, true>` 约束，使漏加或多加色号在**编译期**就报错，
   * 而不是等到线上出现「设置里能选、首屏不生效」这种难查的不一致。
   */
  const VALID_HUES: Record<ColorTheme, true> = {
    forest: true,
    ocean: true,
    violet: true,
    sunset: true,
    mono: true,
    plain: true
  };

  let preference: ThemePreference = 'system';
  let hue: ColorTheme = 'plain';
  try {
    const stored = window.localStorage.getItem(MIRROR_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      preference = stored;
    }
    const storedHue = window.localStorage.getItem(HUE_MIRROR_KEY);
    if (storedHue && storedHue in VALID_HUES) {
      hue = storedHue as ColorTheme;
    }
  } catch {
    // 页面级存储不可用时跟随系统。
  }

  const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;

  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.hue = hue;
})();
