import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';

/**
 * UI 文案轨道（FR-D10.2，双轨之一）。
 * 语言决策链（后续接 settings）：settings.language → 浏览器语言 → zh-CN 兜底。
 * manifest/商店文案轨道使用浏览器原生 _locales 机制，在 i18n 专项落地。
 */
i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false
  }
});

export default i18n;
