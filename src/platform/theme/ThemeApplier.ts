/**
 * 主题应用（三态 system/light/dark，行为规格 C-11）。
 *
 * 双通道：
 *  - 权威设置在 chrome.storage（dataStore.settings）；
 *  - 页面级镜像（tabs:theme）供 theme-init 在渲染前同步读取（防闪烁）。
 * 任何主题变更必须同时写镜像与 documentElement 数据属性。
 */

type ThemePreference = 'system' | 'light' | 'dark';

const THEME_MIRROR_KEY = 'tabs:theme';
const HUE_MIRROR_KEY = 'tabs:theme-hue';

/** 色号定义见 `@/core/theme/colorThemes`（色号 id 的唯一权威来源）。 */
import type { ColorTheme } from '@/core/theme/colorThemes';
export type { ColorTheme };

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 主题过渡类的清理定时器（多次快速切换时后一次覆盖前一次，避免提前收尾）。 */
let themeTransitionTimer: number | undefined;

export function applyTheme(preference: ThemePreference, colorTheme: ColorTheme = 'plain'): void {
  try {
    window.localStorage.setItem(THEME_MIRROR_KEY, preference);
    window.localStorage.setItem(HUE_MIRROR_KEY, colorTheme);
  } catch {
    // 页面级存储不可用时仅影响防闪烁首帧
  }
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  /**
   * 主题切换的平滑过渡：明暗/色号真的发生变化时，给 html 挂 220ms 的
   * theme-transition 类（由 main.css 提供全树颜色过渡），避免整页瞬间跳色。
   * 首帧（theme-init 已写入相同值）不触发；reduced-motion 用户直接跳过。
   */
  const changed = root.dataset.theme !== resolved || root.dataset.hue !== colorTheme;
  if (changed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-transition');
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-transition');
      themeTransitionTimer = undefined;
    }, 220);
  }
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.dataset.hue = colorTheme;
}

/** 系统配色变化时回调（system 模式下实时跟随）。 */
export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
