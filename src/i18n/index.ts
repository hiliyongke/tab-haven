import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';

/**
 * UI 文案轨道（FR-D10.2，双轨之一）。
 * 语言决策链：settings.language（用户覆盖，运行时切换）→ 浏览器 UI 语言 → zh-CN 兜底。
 * manifest/商店文案轨道使用浏览器原生 _locales 机制。
 */

const browserLanguage = globalThis.navigator?.language ?? '';
const initialLanguage = browserLanguage.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false
  }
});

// 同步文档语言：界面语言切换后，<html lang> 跟随（读屏软件据此选择发音与断词规则）。
const syncDocumentLang = (lng: string): void => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
};
syncDocumentLang(i18n.language);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
