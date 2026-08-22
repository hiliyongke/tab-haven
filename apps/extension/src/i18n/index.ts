import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { createTranslate, type Translate, type TranslationOptions } from 'i18n-kit';
import { createUseTranslation, Slot, Trans } from 'i18n-kit/react';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';

/**
 * UI 文案轨道。
 *
 * 语言决策链：settings.language（用户覆盖，运行时切换）→ 浏览器 UI 语言 → en 兜底
 * （与 manifest 的 default_locale 同解，见下方 fallbackLng）。
 * manifest/商店文案轨道使用浏览器原生 _locales 机制。
 *
 * 文案体系（写代码的唯一心智负担是「写中文」）：
 *   - 源码里写母语原文：`t('编辑标签组')`；
 *   - 运行时按原文算出哈希 key 查词典，查不到就回退原文（英文模式因此会露中文，
 *     这正是 `check:i18n` 要拦的事故，不要靠兜底掩盖）；
 *   - 哈希算法在 `packages/i18n-kit/src/hashKey.ts` 单一实现，扫描器与运行时同源。
 */

const browserLanguage = globalThis.navigator?.language ?? '';
// 只认中文前缀，其余一律落 en：日文 / 德文 / 法文用户读到中文比读到
// 英文更不可解，而 en 是这两套 locale 里更通用的那一套。
const initialLanguage = browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

i18next.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  // 兜底语言必须与 manifest 的 default_locale（`wxt.config.ts` = 'en'）同解：
  // 兜底取 'zh-CN' 会与「只认 zh 前缀，其余落 en」的初值判定相反，一旦
  // language 被切成不存在的语种，界面又会掉回中文。
  fallbackLng: 'en',
  // 必须关掉 nsSeparator：本项目无 namespace，而 i18next 默认把 ':' 当命名空间分隔符，
  // 会把 `t('…https://example.com…')` 这类含 URL 的原文切成 "ns=https / key=//example.com…"，
  // 英文模式下渲染出被截断的 URL 并露出中文。
  nsSeparator: false,
  // 同理关掉 keySeparator：词条文件是**扁平**的（键即完整 key，原文里也可能带点号），
  // 再让 i18next 按 '.' 深挖只会把含点号的原文切成不存在的层级。
  keySeparator: false,
  interpolation: {
    escapeValue: false
  }
});

/**
 * 翻译函数：母语原文进，译文出（与后台轨道 `headless.ts` 共用 i18n-kit 那一份实现）。
 */
export const translate = createTranslate(i18next);

/**
 * 组件侧取翻译函数：返回的 `t` 接受母语原文，语言切换的重渲染订阅仍由
 * react-i18next 负责。
 */
export const useTranslation = createUseTranslation(i18next, translate);

export { Trans, Slot };
export type { TranslationOptions, Translate };

// 同步文档语言：界面语言切换后，<html lang> 跟随（读屏软件据此选择发音与断词规则）。
const syncDocumentLang = (lng: string): void => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
};
syncDocumentLang(i18next.language);
i18next.on('languageChanged', syncDocumentLang);

export default i18next;
