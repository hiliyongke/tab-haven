import { createTranslate } from 'i18n-kit';
import type { Translate } from 'i18n-kit';
import i18next from 'i18next';
import { createContext, useContext } from 'react';
import enResources from './i18n/locales/en/translation.json';
import zhResources from './i18n/locales/zh-CN/translation.json';

/**
 * 官网 i18n：与扩展同一套 i18n-kit 工具链，**但词典完全独立**
 * （`site/i18n/` → `site/src/i18n/locales/`，由 `pnpm site:i18n` 编译）。
 *
 * 运行时只用到 `createTranslate`：官网是构建期预渲染，语言由 URL 路径决定
 * （`/` 中文、`/en/` 英文），产物里没有运行时切换，因此不需要 react-i18next 的
 * Provider 与订阅机制 —— 一个 i18next 实例 + 一个 t 就够。
 */
/**
 * 类型标注收口，不用 `as unknown as`：双重断言的作用是「让类型检查闭嘴」，
 * 它不会验证任何东西 —— JSON 的词条形状变了（值不再是字符串）这里照样通过。
 * 标注成目标类型后，形状不符是编译错误，而不是被断言擦掉。
 */
const resources: Record<string, { translation: Record<string, string> }> = {
  'zh-CN': { translation: zhResources },
  en: { translation: enResources }
};

export interface SiteI18n {
  lng: string;
  t: Translate;
}

export function createSiteI18n(lng: string): SiteI18n {
  const instance = i18next.createInstance();
  instance.init({
    lng,
    resources,
    // 未登记文案回退中文原文（由 createTranslate 的 defaultValue 兜底），
    // 比返回空串更容易被发现。
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false }
  });
  return { lng, t: createTranslate(instance) };
}

const I18nContext = createContext<SiteI18n | null>(null);

export function useSiteI18n(): SiteI18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useSiteI18n 必须在 I18nContext.Provider 内部使用');
  return value;
}

export { I18nContext };
