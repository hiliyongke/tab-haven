import { describe, expect, it } from 'vitest';
// 脱敏是 `@/platform/log` 的叶子能力（diagnostics 只是转出口），测试直接取源，
// 免得「测试夹具」被误认成生产 API。
import { redactUrlsForTest } from '@/platform/log';

/**
 * 诊断日志脱敏。
 *
 * 覆盖裸域名 + 路径、带端口及含 user:pass@ 的 URL 形式。
 */
describe('redactUrls', () => {
  it('带协议头的 URL 被脱敏', () => {
    expect(redactUrlsForTest('opened https://example.com/a/b?x=1')).toBe('opened <url>');
  });

  it('裸域名 + 路径被脱敏', () => {
    expect(redactUrlsForTest('failed on example.com/private/path')).toBe('failed on <url>');
  });

  it('带端口被脱敏', () => {
    expect(redactUrlsForTest('server localhost:8080/admin')).toBe('server <url>');
  });

  it('含 user:pass@ 被脱敏', () => {
    expect(redactUrlsForTest('auth user:pass@example.com failed')).toBe('auth <url> failed');
  });

  it('带协议头且含 user:pass@ 也不会残留凭据', () => {
    const out = redactUrlsForTest('go https://user:secret@github.com/x');
    expect(out).toBe('go <url>');
    expect(out).not.toContain('secret');
  });

  it('不误伤普通文本（过度脱敏的反面）', () => {
    expect(redactUrlsForTest('operation failed: no such tab')).toBe(
      'operation failed: no such tab'
    );
  });

  it('多个 URL 全部脱敏', () => {
    expect(redactUrlsForTest('a.com and b.org/x')).toBe('<url> and <url>');
  });
});
