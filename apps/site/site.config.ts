/**
 * 站点级常量：构建脚本（build.mjs / dev.mjs）与渲染代码共用同一份，避免两处漂移。
 */

export const BRAND = 'Tabs';

/**
 * 部署后的站点根 URL（**不带**结尾斜杠）。
 *
 * 留空表示尚未配置域名：build.mjs 会据此**关闭** canonical / hreflang / JSON-LD 的
 * URL 与 sitemap，并打印告警 —— 宁可缺标签，也不能把占位域名发布出去。
 */
export const SITE_URL = '';

export interface SiteLanguage {
  /** i18next 语言代码（与 src/i18n/locales 目录名一致） */
  code: string;
  /** <html lang> 取值 */
  htmlLang: string;
  /** 站点内路径（目录形式，结尾带斜杠） */
  path: string;
  /** 语言切换器上的文案：一律以该语言自身写法呈现 */
  label: string;
}

export const LANGUAGES: readonly SiteLanguage[] = [
  { code: 'zh-CN', htmlLang: 'zh-CN', path: '/', label: '简体中文' },
  { code: 'en', htmlLang: 'en', path: '/en/', label: 'English' }
];

/** 下载包所在目录（构建期由 build.mjs 拷入） */
export const DOWNLOAD_DIR = '/download/';

/**
 * 按语言代码取语言配置。
 *
 * 抛错而不是回退默认值： LANGUAGES 是编译期已知的常量表，索引失败只可能是调用方
 * 传错，静默回退会让「英文站渲染成中文」这种问题藏到产物里才发现。
 */
export function languageOf(code: string): SiteLanguage {
  const found = LANGUAGES.find((item) => item.code === code);
  if (!found) throw new Error(`未知语言代码：${code}`);
  return found;
}
