import { describe, expect, it } from 'vitest';
import { domainToUnicode, hasPunycodeLabel } from '@/core/url/punycode';

/**
 * IDN 展示标签解码（RFC 3492）：
 * 基准值由 Node.js 权威实现 node:url.domainToUnicode 生成（已逐向量复核）。
 */
describe('domainToUnicode', () => {
  it('解码常见 IDN 标签', () => {
    expect(domainToUnicode('xn--fiq228c.cn')).toBe('中文.cn');
    expect(domainToUnicode('xn--fiqs8s')).toBe('中国');
    expect(domainToUnicode('xn--fsqu00a.xn--3lr804guic')).toBe('例子.卷筒纸');
    expect(domainToUnicode('xn--bcher-kva.example')).toBe('bücher.example');
    expect(domainToUnicode('xn--nxasmq6b.example')).toBe('βόλοσ.example');
  });

  it('混合标签：仅解码 xn-- 前缀标签，其余原样保留', () => {
    expect(domainToUnicode('mail.xn--fiq228c.cn')).toBe('mail.中文.cn');
    expect(domainToUnicode('github.io')).toBe('github.io');
    expect(domainToUnicode('localhost:8080')).toBe('localhost:8080');
  });

  it('非 IDN 输入快速路径原样返回', () => {
    expect(domainToUnicode('example.com')).toBe('example.com');
    expect(domainToUnicode('')).toBe('');
  });

  it('非法 punycode 安全回退为原始输入（展示层绝不抛异常）', () => {
    expect(domainToUnicode('xn--!!!')).toBe('xn--!!!');
    expect(domainToUnicode('xn--abc😀.com')).toBe('xn--abc😀.com');
  });
});

describe('hasPunycodeLabel', () => {
  it('给定含 xn-- 的主机名时判定为含 punycode 标签，纯 ASCII 主机名与空串不命中', () => {
    expect(hasPunycodeLabel('xn--fiq228c.cn')).toBe(true);
    expect(hasPunycodeLabel('mail.xn--fiq228c.cn')).toBe(true);
    expect(hasPunycodeLabel('example.com')).toBe(false);
    expect(hasPunycodeLabel('localhost:8080')).toBe(false);
    expect(hasPunycodeLabel('')).toBe(false);
  });
});
