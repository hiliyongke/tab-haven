import { describe, expect, it } from 'vitest';
import {
  LANG_SITE_KEY_PREFIX,
  MIN_LANGUAGE_GROUP_SIZE,
  languageLabel,
  makeLangSiteKey,
  normalizeLanguageCode,
  parseLangSiteKey
} from '@/core/site/sectionLang';

describe('parseLangSiteKey', () => {
  it('Given 有效 BCP-47 语言键 When 反解 Then 返回语言 code', () => {
    expect(parseLangSiteKey('lang:zh-CN')).toBe('zh-CN');
    expect(parseLangSiteKey('lang:en')).toBe('en');
  });

  it('Given 不是语言分区的 siteKey When 反解 Then 返回 undefined', () => {
    expect(parseLangSiteKey('site-example.com')).toBeUndefined();
    expect(parseLangSiteKey('')).toBeUndefined();
  });

  it('Given 形如 lang:80 的 host:port 键 When 反解 Then 因 code 非 BCP-47 返回 undefined', () => {
    expect(parseLangSiteKey('lang:80')).toBeUndefined();
  });

  it('Given code 非法使 Intl 抛错 When 反解 Then 返回 undefined 而不抛出', () => {
    expect(parseLangSiteKey('lang:@@')).toBeUndefined();
  });
});

describe('makeLangSiteKey', () => {
  it('Given 语言 code When 构造 Then 加上统一前缀且可反解', () => {
    expect(makeLangSiteKey('ja')).toBe('lang:ja');
    expect(parseLangSiteKey(makeLangSiteKey('ja'))).toBe('ja');
  });

  it('Given 前缀与成组下限常量 When 检查 Then 构造口径一致且下限为 2', () => {
    expect(LANG_SITE_KEY_PREFIX).toBe('lang:');
    expect(MIN_LANGUAGE_GROUP_SIZE).toBe(2);
  });
});

describe('normalizeLanguageCode', () => {
  it('Given und / undefined When 归一 Then 收敛为 unknown', () => {
    expect(normalizeLanguageCode('und')).toBe('unknown');
    expect(normalizeLanguageCode(undefined)).toBe('unknown');
  });

  it('Given 正常语言 code When 归一 Then 原样保留', () => {
    expect(normalizeLanguageCode('zh-CN')).toBe('zh-CN');
  });
});

describe('languageLabel', () => {
  const identity = (key: string) => key;

  it('Given unknown When 取展示名 Then 走译文键「未知语言」', () => {
    expect(languageLabel('unknown', identity)).toBe('未知语言');
  });

  it('Given 已知语言 code When 取展示名 Then 用母语展示名', () => {
    expect(languageLabel('zh-CN', identity)).toBe('中文（简体）');
    expect(languageLabel('en', identity)).toBe('English');
  });

  it('Given 未知语言 code When 取展示名 Then 回退为大写代码', () => {
    expect(languageLabel('xx', identity)).toBe('XX');
  });
});
