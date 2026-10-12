import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';

/**
 * UI 文案轨道。
 * 语言决策链：settings.language（用户覆盖，运行时切换）→ 浏览器 UI 语言 → zh-CN 兜底。
 * manifest/商店文案轨道使用浏览器原生 _locales 机制。
 */

const browserLanguage = globalThis.navigator?.language ?? '';
// 只认中文前缀，其余一律落 en（决策 D6）：日文 / 德文 / 法文用户读到中文比读到
// 英文更不可解，而 en 是这两套 locale 里更通用的那一套。
const initialLanguage = browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  // 兜底语言必须与 manifest 的 default_locale（`wxt.config.ts:14` = 'en'）同解：
  // 此前这里是 'zh-CN'，与「只认 zh 前缀，其余落 en」的初值判定相反，一旦
  // language 被切成不存在的语种，界面又会掉回中文。
  fallbackLng: 'en',
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
