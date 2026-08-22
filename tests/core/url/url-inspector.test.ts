import { describe, expect, it } from 'vitest';
import { inspectUrl } from '@/core/url/UrlInspector';

/**
 * 行为规格（PRD 附录 C-6 相关）：URL 检视分类与比较键语义。
 */
describe('inspectUrl', () => {
  it('已提交 web 页归为 web，比较键取已提交 URL', () => {
    const result = inspectUrl('https://example.com/a', undefined);
    expect(result.category).toBe('web');
    expect(result.comparisonKey).toBe('https://example.com/a');
  });

  it('导航中（pending 为 web）归为 web，比较键取 pending', () => {
    const result = inspectUrl('about:blank', 'https://example.com/a');
    expect(result.category).toBe('web');
    expect(result.comparisonKey).toBe('https://example.com/a');
  });

  it('空白起始页（含空串）归为 blank-start', () => {
    for (const url of ['', 'about:blank', 'chrome://newtab/', 'chrome://new-tab-page/']) {
      expect(inspectUrl(url, undefined).category).toBe('blank-start');
    }
  });

  it('浏览器内部页（chrome:// 等）归为 internal', () => {
    expect(inspectUrl('chrome://extensions/', undefined).category).toBe('internal');
    expect(inspectUrl('file:///tmp/x', undefined).category).toBe('internal');
  });

  it('空白起始页正在导航到内部页：仍归 blank-start（等待真实导航）', () => {
    const result = inspectUrl('about:blank', 'chrome://extensions/');
    expect(result.category).toBe('blank-start');
  });

  it('已提交为空 + 无 pending：归 blank-start（标签刚创建等待导航）', () => {
    expect(inspectUrl(undefined, undefined).category).toBe('blank-start');
  });
});
