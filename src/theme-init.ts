/**
 * 主题防闪烁初始化（继承 Tabstead 基线方案，React 化适配）。
 *
 * Tabstead 基线在 HTML head 同步执行；TabHaven 为 React CSR（body 初始
 * 为空），本模块作为各入口 main.tsx 的**第一个 import**（在 React 渲染
 * 前）执行，同样可完全避免浅色/深色切换瞬间的主题闪烁。
 *
 * 从 localStorage 镜像读取主题偏好并立即设置 data-theme。权威存储为
 * chrome.storage（异步），本模块只读同步可用的镜像 key——正式主题
 * 模块落地时双写该镜像（见 docs/ARCHITECTURE.md 第 12 章主题项）。
 */
(() => {
  const key = 'tabhaven:theme';
  let preference = 'system';
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === 'system' || saved === 'light' || saved === 'dark') {
      preference = saved;
    }
  } catch {
    // 页面级存储不可用时跟随系统。
  }
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = preference === 'system' ? systemTheme : preference;
})();
