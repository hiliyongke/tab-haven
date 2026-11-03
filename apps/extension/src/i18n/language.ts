/** UI 支持的语言码（设置覆盖值与浏览器语言解析共用同一集合）。 */
export type UiLanguage = 'zh-CN' | 'en';

/** 浏览器语言 → UI 语言：只认中文前缀，其余落 en（日文/德文/法文读中文比读英文更不可解）。 */
export function resolveBrowserLanguage(language: string | undefined): UiLanguage {
  return language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
