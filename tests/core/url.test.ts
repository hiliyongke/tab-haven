import { describe, expect, it } from 'vitest';
import { comparableUrl, isBlankStartUrl, isReusableUrl } from '@/core/url';

describe('comparableUrl', () => {
  it('优先取 pendingUrl（导航中）', () => {
    expect(comparableUrl({ pendingUrl: 'https://a.com/', url: 'https://old.com/' })).toBe(
      'https://a.com/'
    );
  });

  it('无 pendingUrl 时取已提交 url', () => {
    expect(comparableUrl({ pendingUrl: undefined, url: 'https://b.com/' })).toBe('https://b.com/');
  });

  it('均为空时返回空串', () => {
    expect(comparableUrl({ pendingUrl: undefined, url: undefined })).toBe('');
  });
});

describe('isReusableUrl', () => {
  it('http/https 可复用', () => {
    expect(isReusableUrl('https://example.com/a')).toBe(true);
    expect(isReusableUrl('http://example.com/a')).toBe(true);
  });

  it('非 http/https 不可复用', () => {
    expect(isReusableUrl('chrome://newtab/')).toBe(false);
    expect(isReusableUrl('about:blank')).toBe(false);
    expect(isReusableUrl('')).toBe(false);
    expect(isReusableUrl('file:///tmp/x')).toBe(false);
  });
});

describe('isBlankStartUrl', () => {
  it('空白起始页判定', () => {
    expect(isBlankStartUrl('')).toBe(true);
    expect(isBlankStartUrl('about:blank')).toBe(true);
    expect(isBlankStartUrl('chrome://newtab/')).toBe(true);
    expect(isBlankStartUrl('chrome://new-tab-page/')).toBe(true);
  });

  it('正常页面非空白', () => {
    expect(isBlankStartUrl('https://example.com')).toBe(false);
  });
});
