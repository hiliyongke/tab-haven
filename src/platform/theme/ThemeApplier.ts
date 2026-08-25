/**
 * 主题应用（三态 system/light/dark，行为规格 C-11）。
 *
 * 双通道：
 *  - 权威设置在 chrome.storage（dataStore.settings）；
 *  - 页面级镜像（tabhaven:theme）供 theme-init 在渲染前同步读取（防闪烁）。
 * 任何主题变更必须同时写镜像与 documentElement 数据属性。
 */

type ThemePreference = 'system' | 'light' | 'dark';
/** 主题色预设（与 models.ts SettingsSchema.colorTheme 保持一致）。 */
export type ColorTheme = 'forest' | 'ocean' | 'violet' | 'sunset' | 'mono';

const THEME_MIRROR_KEY = 'tabhaven:theme';
const HUE_MIRROR_KEY = 'tabhaven:theme-hue';

export const COLOR_THEMES: readonly ColorTheme[] = ['forest', 'ocean', 'violet', 'sunset', 'mono'];

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference: ThemePreference, colorTheme: ColorTheme = 'forest'): void {
  try {
    window.localStorage.setItem(THEME_MIRROR_KEY, preference);
    window.localStorage.setItem(HUE_MIRROR_KEY, colorTheme);
  } catch {
    // 页面级存储不可用时仅影响防闪烁首帧
  }
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.hue = colorTheme;
}

/** 系统配色变化时回调（system 模式下实时跟随）。 */
export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
