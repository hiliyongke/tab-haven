import { describe, expect, it } from 'vitest';
import { hashString, isHashKey, toHashKey } from 'i18n-kit';

/**
 * 哈希 key 的行为规格。
 *
 * 这里的每一条都对应一类真实事故：key 一旦与扫描器或运行时算出的不一致，
 * 表现都是「英文模式某句露中文」，而且从代码上看不出来。
 */
describe('toHashKey', () => {
  it('Given 同一句原文，When 反复计算，Then 恒等（多处复用同一条译文的前提）', () => {
    expect(toHashKey('编辑标签组')).toBe(toHashKey('编辑标签组'));
  });

  it('Given 空白不同的同一句，When 计算，Then key 相同（换行/缩进不产生新词条）', () => {
    expect(toHashKey('编辑 标签组')).toBe(toHashKey('编辑标签组'));
    expect(toHashKey('编辑\n标签组')).toBe(toHashKey('编辑标签组'));
  });

  it('Given 不同原文，When 计算，Then key 不同', () => {
    expect(toHashKey('编辑标签组')).not.toBe(toHashKey('新建标签组'));
  });

  it('Given context，When 计算，Then key 带上下文后缀（同一句可有不同译法）', () => {
    expect(toHashKey('打开', 'verb')).toBe(`${toHashKey('打开')}_verb`);
  });

  it('Given 空 context，When 计算，Then 与不传 context 一致', () => {
    expect(toHashKey('打开', '')).toBe(toHashKey('打开'));
  });

  it('Given 任意原文，When 计算，Then key 不含 i18next 的分隔符（. 与 :）', () => {
    for (const sentence of ['编辑标签组', '访问 https://example.com 查看', 'a.b:c', '']) {
      const key = toHashKey(sentence);
      expect(key).not.toContain('.');
      expect(key).not.toContain(':');
      expect(key).not.toContain('-');
    }
  });

  it('Given 任意原文，When 计算，Then 形如 i18n_ 加 7 位 36 进制摘要', () => {
    expect(toHashKey('编辑标签组')).toMatch(/^i18n_[0-9a-z]{7}$/);
  });
});

describe('hashString', () => {
  it('Given 任意字符串，When 摘要，Then 为无符号 32 位整数（不出现负号与小数点）', () => {
    for (const input of ['', 'a', '编辑标签组', 'x'.repeat(1000)]) {
      const digest = hashString(input);
      expect(Number.isInteger(digest)).toBe(true);
      expect(digest).toBeGreaterThanOrEqual(0);
      expect(digest).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('Given 空串，When 摘要，Then 为 djb2 初值 5381', () => {
    expect(hashString('')).toBe(5381);
  });
});

describe('isHashKey', () => {
  it('Given 哈希 key，When 判定，Then 为真', () => {
    expect(isHashKey(toHashKey('编辑标签组'))).toBe(true);
    expect(isHashKey(`${toHashKey('打开')}_verb`)).toBe(true);
  });

  it('Given 语义化点号 key，When 判定，Then 为假（区分迁移期遗留）', () => {
    expect(isHashKey('settings.theme')).toBe(false);
    expect(isHashKey('groups.color.grey')).toBe(false);
  });
});
