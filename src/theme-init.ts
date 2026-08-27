/**
 * 主题初始化（在 React 渲染前执行，防闪烁）。
 *
 * 从页面级存储的镜像键同步读取主题偏好并立即设置 documentElement 数据属性。
 * 权威设置在 chrome.storage（异步），本模块只读同步可用的镜像以避免首屏闪烁。
 *
 * 调用约定：各入口 main.tsx 的首个 import。
 */
(() => {
  const MIRROR_KEY = 'tabhaven:theme';
  const HUE_MIRROR_KEY = 'tabhaven:theme-hue';

  type ThemePreference = 'system' | 'light' | 'dark';
  type ColorTheme = 'forest' | 'ocean' | 'violet' | 'sunset' | 'mono' | 'plain';

  let preference: ThemePreference = 'system';
  let hue: ColorTheme = 'forest';
  try {
    const stored = window.localStorage.getItem(MIRROR_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      preference = stored;
    }
    const storedHue = window.localStorage.getItem(HUE_MIRROR_KEY);
    if (
      storedHue === 'forest' ||
      storedHue === 'ocean' ||
      storedHue === 'violet' ||
      storedHue === 'sunset' ||
      storedHue === 'mono' ||
      storedHue === 'plain'
    ) {
      hue = storedHue;
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
