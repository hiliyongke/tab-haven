import { describe, expect, it } from 'vitest';
import { resolveBrowserLanguage } from '@/i18n/language';

describe('浏览器语言解析', () => {
  it('中文前缀解析为 zh-CN，其余语言回退为 en', () => {
    expect(resolveBrowserLanguage('zh-CN')).toBe('zh-CN');
    expect(resolveBrowserLanguage('zh-TW')).toBe('zh-CN');
    expect(resolveBrowserLanguage('ZH-Hans')).toBe('zh-CN');
    expect(resolveBrowserLanguage('en-US')).toBe('en');
    expect(resolveBrowserLanguage('ja-JP')).toBe('en');
    expect(resolveBrowserLanguage(undefined)).toBe('en');
  });
});
