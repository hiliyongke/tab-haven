import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { createTranslate, type Translate, type TranslationOptions } from 'i18n-kit';
import { createUseTranslation, Slot, Trans } from 'i18n-kit/react';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';

/**
 * UI 文案轨道。语言决策链：settings.language（用户覆盖，运行时切换）→ 浏览器 UI 语言 → en 兜底
 * （与 manifest 的 default_locale 同解，见 fallbackLng）。manifest/商店文案走浏览器原生 _locales。
 *
 * 写代码的唯一心智负担是「写中文」：`t('编辑标签组')` 运行时按原文算哈希 key 查词典，
 * 查不到回退原文（英文模式因此露中文，这正是 `check:i18n` 要拦的事故，不要靠兜底掩盖）。
 * 哈希算法在 `packages/i18n-kit/src/hashKey.ts` 单一实现，扫描器与运行时同源。
 */

const browserLanguage = globalThis.navigator?.language ?? '';
// 只认中文前缀，其余落 en：日文/德文/法文用户读到中文比读到英文更不可解。
const initialLanguage = browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

i18next.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  // 兜底必须与 default_locale（`wxt.config.ts` = 'en'）同解：取 'zh-CN' 会与初值判定相反，
  // 一旦 language 被切成不存在的语种，界面会掉回中文。
  fallbackLng: 'en',
  // 本项目无 namespace，而 i18next 默认把 ':' 当 ns 分隔符，会把含 URL 的原文切成
  // "ns=https / key=//example.com…"，英文模式渲染出被截断的 URL 并露中文。
  nsSeparator: false,
  // 词条文件是扁平的（键即完整 key，原文里也可能带点号），按 '.' 深挖只会切成不存在的层级。
  keySeparator: false,
  interpolation: {
    escapeValue: false
  }
});

/** 翻译函数：母语原文进，译文出（与后台轨道 `headless.ts` 共用 i18n-kit 那一份实现）。 */
export const translate = createTranslate(i18next);

/** 组件侧取翻译函数：返回的 `t` 接受母语原文，语言切换的重渲染订阅仍由 react-i18next 负责。 */
export const useTranslation = createUseTranslation(i18next, translate);

export { Trans, Slot };
export type { TranslationOptions, Translate };

// 同步文档语言：切换后 <html lang> 跟随（读屏据此选发音与断词规则）。
const syncDocumentLang = (lng: string): void => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
};
syncDocumentLang(i18next.language);
i18next.on('languageChanged', syncDocumentLang);

export default i18next;
