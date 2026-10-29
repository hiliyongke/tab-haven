/**
 * 主题应用（三态 system/light/dark）。
 *
 * 双通道：
 *  - 权威设置在 chrome.storage（dataStore.settings）；
 *  - 页面级镜像（tabs:theme）供 theme-init 在渲染前同步读取（防闪烁）。
 * 任何主题变更必须同时写镜像与 documentElement 数据属性。
 */

type ThemePreference = 'system' | 'light' | 'dark';

const THEME_MIRROR_KEY = 'tabs:theme';
const HUE_MIRROR_KEY = 'tabs:theme-hue';

/**
 * 过渡时长：须 ≥ main.css 里 `.theme-transition` 的 transition-duration，
 * 提前摘类会把过渡截断成跳色。
 */
const THEME_TRANSITION_MS = 220;

/** 色号定义见 `@/core/theme/colorThemes`（色号 id 的唯一权威来源）。 */
import type { ColorTheme } from '@/core/theme/colorThemes';
import { logDegraded } from '@/platform/diagnostics';
export type { ColorTheme };

/**
 * 读取媒体查询；`window.matchMedia` 缺失/不可调用时返回 undefined 而非抛错。
 *
 * 降级而非抛错的理由：主题是**装饰性**能力，`applyTheme` 又挂在每次设置落盘之后
 * （数据/快照/导入各条写路径都会走到）。matchMedia 缺失的环境（jsdom、被裁剪的
 * 宿主、个别嵌入式 webview）若让它抛，一次主题应用就会连带把整条设置写入路径打断
 * —— 用户看到的是「保存设置失败」，而根因只是没有媒体查询 API。
 */
function matchMediaSafe(query: string): MediaQueryList | undefined {
  if (typeof window.matchMedia !== 'function') return undefined;
  try {
    return window.matchMedia(query);
  } catch (error) {
    logDegraded('theme', `matchMedia(${query}) 不可用，相关判定已降级`, error);
    return undefined;
  }
}

/** matchMedia 不可用时的既定兜底（与「跟随系统」在无法探测系统配色时的落点一致）。 */
const FALLBACK_THEME: 'light' | 'dark' = 'light';

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  const query = matchMediaSafe('(prefers-color-scheme: dark)');
  if (!query) {
    // 探测不到系统配色：降级为浅色并留痕，绝不让装饰性能力变成致命路径。
    logDegraded('theme', 'matchMedia 不可用，无法跟随系统配色，已降级为浅色');
    return FALLBACK_THEME;
  }
  return query.matches ? 'dark' : 'light';
}

/** 主题过渡类的清理定时器（多次快速切换时后一次覆盖前一次，避免提前收尾）。 */
let themeTransitionTimer: number | undefined;

export function applyTheme(preference: ThemePreference, colorTheme: ColorTheme = 'plain'): void {
  try {
    // 先比对再写：localStorage 是**同步** API，无条件写两条会让每次设置变更
    // （applyTheme 在每次设置落盘后被调用）都付两次主线程阻塞，而值往往根本没变。
    if (window.localStorage.getItem(THEME_MIRROR_KEY) !== preference) {
      window.localStorage.setItem(THEME_MIRROR_KEY, preference);
    }
    if (window.localStorage.getItem(HUE_MIRROR_KEY) !== colorTheme) {
      window.localStorage.setItem(HUE_MIRROR_KEY, colorTheme);
    }
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
  // 同 resolveTheme：reduce-motion 探测不到时按「不启用过渡」处理（少一个动画，
  // 不是错误），不能让缺失的 API 把整次主题应用打断。
  const reduceMotion = matchMediaSafe('(prefers-reduced-motion: reduce)')?.matches ?? true;
  if (changed && !reduceMotion) {
    root.classList.add('theme-transition');
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-transition');
      themeTransitionTimer = undefined;
    }, THEME_TRANSITION_MS);
  }
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.dataset.hue = colorTheme;
}

/** 系统配色变化时回调（system 模式下实时跟随）。 */
export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  const query = matchMediaSafe('(prefers-color-scheme: dark)');
  // 与 resolveTheme 同口径：探测不到就根本没有「跟随系统」可谈，退化为空订阅
  // （返回值仍是合法的注销函数，调用方无需分支），而不是抛错打断面板启动。
  if (!query) return () => undefined;
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
