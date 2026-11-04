/** 语言分区 siteKey 的前缀：构造与反解的唯一口径，判定用 `parseLangSiteKey(...) !== undefined`。 */
export const LANG_SITE_KEY_PREFIX = 'lang:';

/** 语言分区的成组下限：单标签语言组没有组织意义（与站点阈值语义不同，故独立成常量）。 */
export const MIN_LANGUAGE_GROUP_SIZE = 2;

/** 构造语言分区的 siteKey。 */
export function makeLangSiteKey(code: string): string {
  return `${LANG_SITE_KEY_PREFIX}${code}`;
}

/**
 * 反解语言分区 siteKey；不是语言分区时返回 undefined。
 *
 * 语言 code 必须是有效 BCP-47 标签，避免 `lang:80` 这类真实 host:port 键被识别为语言分区。
 */
export function parseLangSiteKey(siteKey: string): string | undefined {
  if (!siteKey.startsWith(LANG_SITE_KEY_PREFIX)) return undefined;
  const code = siteKey.slice(LANG_SITE_KEY_PREFIX.length);
  try {
    return Intl.getCanonicalLocales(code).length === 1 ? code : undefined;
  } catch {
    return undefined;
  }
}

/** 常见语言的 BCP-47 代码 → 展示名（其余回退为大写代码）。 */
const LANGUAGE_LABELS: Record<string, string> = {
  // 语言名以该语言自身写法呈现（英文界面里也写作「中文（简体）」），不是漏译
  'zh-CN': '中文（简体）', // @i18n-ignore
  'zh-TW': '中文（繁体）', // @i18n-ignore
  en: 'English',
  ja: '日本語', // @i18n-ignore
  ko: '한국어',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  ar: 'العربية'
};
/**
 * 语言码归一：Chrome 对「无法判定」可能返回 BCP-47 的 `und`，与本地哨兵 `unknown` 同义。
 * 不归并会多出一个标题为「UND」的分组，且与 `unknown` 分组分裂。
 */
export function normalizeLanguageCode(code: string | undefined): string {
  return !code || code === 'und' ? 'unknown' : code;
}

export function languageLabel(code: string, t: (key: string) => string): string {
  if (code === 'unknown') return t('未知语言');
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}
