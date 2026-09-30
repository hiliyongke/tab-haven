import { describe, expect, it } from 'vitest';
import { redactUrlsForTest } from '@/platform/diagnostics';

/**
 * 诊断日志脱敏（R17 / S-2）。
 *
 * 锁死三种此前的脱漏形式：裸域名 + 路径、带端口、含 user:pass@。
 * 旧正则只认 http(s):// 前缀，这三种会原样落盘。
 */
describe('redactUrls', () => {
  it('带协议头的 URL 仍被脱敏（回归）', () => {
    expect(redactUrlsForTest('opened https://example.com/a/b?x=1')).toBe('opened <url>');
  });

  it('裸域名 + 路径被脱敏（此前漏）', () => {
    expect(redactUrlsForTest('failed on example.com/private/path')).toBe('failed on <url>');
  });

  it('带端口被脱敏（此前漏）', () => {
    expect(redactUrlsForTest('server localhost:8080/admin')).toBe('server <url>');
  });

  it('含 user:pass@ 被脱敏（此前漏）', () => {
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
