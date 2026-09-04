import { describe, expect, it } from 'vitest';
import { buildNoCacheDnrRules, matchesNoCachePattern } from '@/platform/nocache/noCacheRules';

/**
 * 开发者禁缓存：URL 命中判定 / DNR 规则编译（platform 层）。
 * pattern 的归一化与校验已下沉到 core，见
 * `tests/core/nocache/no-cache-pattern.test.ts`。
 *
 * 重点保证两条链路口径一致：
 *  1. JS 侧命中判定（横幅注入）；
 *  2. DNR 规则条件（urlFilter / regexFilter，RE2 与 JS RegExp 在本特性使用的
 *     简单模式子集上语义等价，可用 RegExp 交叉验证）。
 */

describe('matchesNoCachePattern', () => {
  describe('形态 2：纯域名（裸域 + 任意深度子域）', () => {
    it.each([
      ['https://example.com/', true],
      ['http://example.com', true],
      ['https://www.example.com/page', true],
      ['https://a.b.example.com:9443/x', true],
      ['https://badexample.com/', false], // 伪装域名不命中
      ['https://not.example.com.evil.io/', false], // pattern 作为中段标签不命中
      ['chrome://example.com/', false], // 非 http(s) 不命中
      ['file:///example.com', false]
    ])('%s → %s', (url, expected) => {
      expect(matchesNoCachePattern(url, 'example.com')).toBe(expected);
    });
  });

  describe('形态 3：域名 + 路径前缀', () => {
    it.each([
      ['https://example.com/app', true],
      ['https://example.com/app/detail?id=1', true],
      ['https://example.com/apples', true], // 前缀语义（与 DNR urlFilter 一致）
      ['https://example.com/', false],
      ['https://www.example.com/app', false], // 裸 host 精确匹配，不含子域
      ['https://evil.com/.example.com/app', false]
    ])('%s → %s', (url, expected) => {
      expect(matchesNoCachePattern(url, 'example.com/app')).toBe(expected);
    });
  });

  describe('形态 1：完整 URL 前缀', () => {
    it.each([
      ['https://example.com/app', true],
      ['https://example.com/app?x=1', true],
      ['https://example.com/apps', true], // 前缀语义
      ['http://example.com/app', false], // scheme 精确
      ['https://www.example.com/app', false] // host 精确（不含子域）
    ])('%s → %s', (url, expected) => {
      expect(matchesNoCachePattern(url, 'https://example.com/app')).toBe(expected);
    });
  });

  it('无效 URL 一律不命中', () => {
    expect(matchesNoCachePattern('not a url', 'example.com')).toBe(false);
  });
});

describe('buildNoCacheDnrRules', () => {
  it('id 与 pattern 下标一一对应（从 1 递增，全量替换可稳定清理）', () => {
    const rules = buildNoCacheDnrRules(['a.com', 'b.com/p', 'https://c.com']);
    expect(rules.map((rule) => rule.id)).toEqual([1, 2, 3]);
  });

  it('三类 pattern 编译为对应条件形态', () => {
    const rules = buildNoCacheDnrRules([
      'https://example.com/app',
      'example.com',
      'example.com/app'
    ]);
    expect(rules).toHaveLength(3);
    expect(rules[0]!.condition.urlFilter).toBe('https://example.com/app');
    expect(rules[1]!.condition.regexFilter).toBe('^https?://([^/?#]+\\.)?example\\.com([/:?#]|$)');
    expect(rules[2]!.condition.urlFilter).toBe('||example.com/app');
  });

  it('双通道禁缓存：请求头 no-cache 绕过已有缓存（DevTools 同款），响应头 no-store 阻止落盘', () => {
    const rule = buildNoCacheDnrRules(['example.com'])[0]!;
    expect(rule.action.type).toBe('modifyHeaders');
    // 请求头：缓存查找阶段即放行，强制发网络请求（修复「资源已在缓存中、不发请求、规则不触发」的失效场景）
    expect(rule.action.requestHeaders).toContainEqual({
      header: 'Cache-Control',
      operation: 'set',
      value: 'no-cache'
    });
    expect(rule.action.requestHeaders).toContainEqual({
      header: 'Pragma',
      operation: 'set',
      value: 'no-cache'
    });
    // 响应头：新响应不落盘 + 协商标识失效
    expect(rule.action.responseHeaders).toContainEqual({
      header: 'Cache-Control',
      operation: 'set',
      value: 'no-cache, no-store, must-revalidate'
    });
    expect(rule.action.responseHeaders).toContainEqual({ header: 'ETag', operation: 'remove' });
    expect(rule.condition.resourceTypes).toContain('main_frame');
  });

  it('纯域名的 regexFilter 与 JS 侧命中判定语义一致（DNR 采用 RE2，本模式子集等价）', () => {
    const cases: Array<[string, boolean]> = [
      ['https://example.com/', true],
      ['https://www.example.com/', true],
      ['https://a.b.example.com:8080/x?y=1', true],
      ['http://example.com', true],
      ['https://badexample.com/', false],
      ['https://example.com.evil.io/', false],
      ['https://notexample.com/', false],
      ['ftp://example.com/', false]
    ];
    const { regexFilter } = buildNoCacheDnrRules(['example.com'])[0]!.condition;
    const regex = new RegExp(regexFilter!);
    for (const [url, expected] of cases) {
      expect(regex.test(url)).toBe(expected);
      expect(matchesNoCachePattern(url, 'example.com')).toBe(expected);
    }
  });

  it('空列表产出空规则集（同步时可整体清空）', () => {
    expect(buildNoCacheDnrRules([])).toEqual([]);
  });
});
