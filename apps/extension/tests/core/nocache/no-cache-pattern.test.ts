import { describe, expect, it } from 'vitest';
import { normalizeNoCachePattern, NO_CACHE_PATTERNS_LIMIT } from '@/core/nocache/noCachePattern';
import { SettingsSchema } from '@/core/schema/models';

/**
 * 禁缓存 pattern 归一化（core 层纯逻辑）。
 *
 * 关键点：这些字符串最终会被编译成 DNR 动态规则的 urlFilter / regexFilter，
 * 因此归一化不是「美化输入」而是**安全边界**——凡是能逃过这里的字符，
 * 都会在浏览器侧变成通配/锚定语义。
 */

describe('normalizeNoCachePattern', () => {
  it('纯域名：小写归一', () => {
    expect(normalizeNoCachePattern('  EXAMPLE.com ')).toBe('example.com');
  });

  it('域名 + 路径：host 小写、路径保留大小写', () => {
    expect(normalizeNoCachePattern('Example.com/App/V2')).toBe('example.com/App/V2');
  });

  it('完整 URL 前缀：scheme/host 小写、端口与路径保留', () => {
    expect(normalizeNoCachePattern('HTTPS://Local.Host:8080/app?x=1')).toBe(
      'https://local.host:8080/app?x=1'
    );
  });

  it('非法输入返回 null', () => {
    expect(normalizeNoCachePattern('')).toBeNull();
    expect(normalizeNoCachePattern('   ')).toBeNull();
    expect(normalizeNoCachePattern('ftp://example.com')).toBeNull(); // 仅支持 http/https
    expect(normalizeNoCachePattern('example.com:8080')).toBeNull(); // 带端口的纯域名 → 走完整前缀形态
    expect(normalizeNoCachePattern('example..com')).toBeNull();
    expect(normalizeNoCachePattern('a b.com')).toBeNull(); // 含空白
    expect(normalizeNoCachePattern('example.com|')).toBeNull(); // DNR 锚字符
    expect(normalizeNoCachePattern('*.example.com')).toBeNull(); // DNR 通配符
    expect(normalizeNoCachePattern('ex^mple.com')).toBeNull();
    expect(normalizeNoCachePattern('-example.com')).toBeNull(); // 首尾非法字符
    expect(normalizeNoCachePattern('https://')).toBeNull(); // 无法解析的 URL
  });

  it('裸 TLD 被拒绝（单标签主机只放行 localhost）', () => {
    // 裸 TLD 会匹配整个顶级域，因此仅放行 localhost 作为单标签主机。
    expect(normalizeNoCachePattern('com')).toBeNull();
    expect(normalizeNoCachePattern('io')).toBeNull();
    // 本机名是唯一放行的单标签主机（对本机服务禁缓存的合法需求）
    expect(normalizeNoCachePattern('localhost')).toBe('localhost');
  });
});

/** SettingsSchema 校验禁缓存规则的行为规格：导入与同步设置中的 DNR 通配和锚定语法均被拒绝。 */
describe('SettingsSchema.noCachePatterns', () => {
  it('丢弃含 DNR 通配/锚定语法的条目（导入路径不可绕过）', () => {
    const parsed = SettingsSchema.safeParse({
      noCachePatterns: ['https://*', 'http://*', '*.example.com', 'a.com|b.com', 'ex^ample.com']
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.noCachePatterns).toEqual([]);
  });

  it('保留合法条目并归一化（非法项不牵连其余项）', () => {
    const parsed = SettingsSchema.safeParse({
      noCachePatterns: ['  EXAMPLE.com ', 'https://*', 'good.com/app']
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.noCachePatterns).toEqual(['example.com', 'good.com/app']);
  });

  it('缺省为空数组', () => {
    expect(SettingsSchema.parse({}).noCachePatterns).toEqual([]);
  });

  it('归一化后去重：同一站点的多种写法只占一份额度', () => {
    // 同一站点的多种写法归一化后只占一份额度，并保留一条规则。
    const parsed = SettingsSchema.safeParse({
      noCachePatterns: ['a.com', 'A.COM', 'a.com/']
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.noCachePatterns).toEqual(['a.com', 'a.com/']);
  });

  it('超出上限的归一化结果被拒绝（上限作用于去重之后）', () => {
    const patterns = Array.from({ length: NO_CACHE_PATTERNS_LIMIT + 1 }, (_, i) => `s${i}.com`);
    expect(SettingsSchema.safeParse({ noCachePatterns: patterns }).success).toBe(false);
    // 重复写法不额外占额度：同额度的数组里一半是重复项时仍然通过
    const duplicated = Array.from({ length: NO_CACHE_PATTERNS_LIMIT }, (_, i) =>
      i % 2 === 0 ? `s${i}.com` : `S${i - 1}.COM`
    );
    expect(SettingsSchema.safeParse({ noCachePatterns: duplicated }).success).toBe(true);
  });
});
