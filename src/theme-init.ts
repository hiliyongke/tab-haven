/**
 * 主题初始化（在 React 渲染前执行，防闪烁）。
 *
 * 机制：从页面级存储的镜像键同步读取主题偏好，立即在 documentElement 上
 * 设置主题数据属性；偏好为"跟随系统"时以系统配色方案解析当前主题。
 * 权威主题设置在 chrome.storage（异步），本模块只读同步可用的镜像——
 * 主题设置模块落地时负责双写该镜像。
 *
 * 调用约定：各入口 main.tsx 的首个 import。
 */
(() => {
  const MIRROR_KEY = 'tabhaven:theme';

  type ThemePreference = 'system' | 'light' | 'dark';

  let preference: ThemePreference = 'system';
  try {
    const stored = window.localStorage.getItem(MIRROR_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      preference = stored;
    }
  } catch {
    // 页面级存储不可用时跟随系统。
  }

  const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;

  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
})();
