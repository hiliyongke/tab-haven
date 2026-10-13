import i18next from 'i18next';
import { createTranslate, type TranslationOptions } from 'i18n-kit';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';
import { settingsRepository } from '@/platform/storage/repositories';

/**
 * 无 UI 环境的文案轨道：供 background SW 等非 React 上下文使用。
 *
 * 与 `src/i18n/index.ts`（UI 轨道）共用同一份资源文件，语言决策链一致：
 * settings.language（用户覆盖，实时跟随）→ 浏览器 UI 语言 → en 兜底
 * （与 manifest 的 default_locale 同解，见下方 fallbackLng）。
 *
 * 说明：
 * - 不引 react-i18next，避免把 React 拉进 SW bundle；
 * - i18next 无后端时同步初始化完成，initHeadlessI18n 之前的 t() 调用
 *   即刻可用（浏览器语言），设置读取完成后按需切换；
 * - SW 每次被回收后重新拉起时模块重新执行，无需额外恢复逻辑。
 */

const browserLanguage = globalThis.navigator?.language ?? '';
// 与 UI 轨道（`src/i18n/index.ts`）同一判定：只认中文前缀，其余一律落 en。
// 此处若反过方向（en 前缀判 en、其余落 zh-CN），日文 / 德文 / 法文用户会得到
// 中文的右键菜单与通知，而同一浏览器里的面板却是英文 —— 两条轨道必须同解。
const initialLanguage = browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

const instance = i18next.createInstance();
void instance.init({
  // 两条轨道共用同一份扁平词条：词条文件即编译产物（见 scripts/i18n/apply.mjs）。
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  // 与 UI 轨道（`src/i18n/index.ts`）保持一致：manifest 的 default_locale 是 en，
  // 两条轨道必须同解，否则英文用户的右键菜单 / 通知会掉成中文而面板是英文。
  fallbackLng: 'en',
  // 与 UI 轨道同口径关掉命名空间分隔：含 URL 的原文（如卸载页提示）不会被 ':' 截断。
  nsSeparator: false,
  // 同上，词条文件是扁平的，再按 '.' 深挖只会把含点号的原文切成不存在的层级。
  keySeparator: false,
  interpolation: {
    escapeValue: false
  }
});

/** 查表实现与 UI 轨道同源（core/i18n/translate.ts），避免两条轨道口径漂移。 */
const translate = createTranslate(instance);

/** 已启动标记：重复调用幂等（模块级状态在 SW 回收后自然重置）。 */
let started = false;

/**
 * 按设置初始化语言并订阅变更（设置存储变更 → 实时切换文案语言）。
 * 读取失败保持浏览器语言兜底，不抛错（文案属尽力而为链路）。
 */
export async function initHeadlessI18n(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const settings = await settingsRepository.read();
    if (settings.language) await instance.changeLanguage(settings.language);
    settingsRepository.watch((next) => {
      // 与 UI 轨道 SettingsSync 一致：有覆盖值才切换，否则回到浏览器语言判定。
      if (next.language) void instance.changeLanguage(next.language);
    });
  } catch {
    // settings 读取失败：保持 initialLanguage，后续 watch 纠正
  }
}

/**
 * 无 UI 上下文的翻译函数（与 UI 轨道的 t() 同一份文案资源、同一份查表逻辑）。
 *
 * 同样接受母语原文：SW 侧文案（右键菜单 / 通知 / 角标）也只写中文。
 */
export function t(sentence: string, options?: TranslationOptions): string {
  return translate(sentence, options);
}
