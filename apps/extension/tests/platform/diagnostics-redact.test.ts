import { afterEach, describe, expect, it, vi } from 'vitest';
// 脱敏是 `@/platform/log` 的叶子能力（diagnostics 只是转出口），测试直接取源，
// 免得「测试夹具」被误认成生产 API。
import {
  clearDiagnosticBuffer,
  logDegraded,
  logFailure,
  readDiagnostics,
  redactUrlsForTest
} from '@/platform/log';

/**
 * 诊断日志脱敏。
 *
 * 覆盖裸域名 + 路径、带端口及含 user:pass@ 的 URL 形式。
 */
afterEach(() => {
  clearDiagnosticBuffer();
  vi.restoreAllMocks();
});

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

  it('单标签内网主机路径脱敏且保留源码路径', () => {
    expect(
      redactUrlsForTest(
        '访问 intranet/private/path 与 localhost/admin?token=secret；定位 apps/extension/src/core/Sections.ts:31'
      )
    ).toBe('访问 <url> 与 <url>；定位 apps/extension/src/core/Sections.ts:31');
  });

  it('真实 md / sh 公共后缀域名不得借文件白名单漏脱敏', () => {
    expect(redactUrlsForTest('访问 example.md')).toBe('访问 <url>');
    expect(redactUrlsForTest('访问 example.md:443/private')).toBe('访问 <url>');
    expect(redactUrlsForTest('访问 example.sh:443/private')).toBe('访问 <url>');
  });

  it('代码 API 标识符保留，真实同形 URL 仍脱敏', () => {
    expect(redactUrlsForTest('当前浏览器不支持 sidePanel.open')).toBe(
      '当前浏览器不支持 sidePanel.open'
    );
    expect(redactUrlsForTest('访问 sidePanel.open/private')).toBe('访问 <url>');
  });

  it('保留代码行与存储键等排障上下文', () => {
    expect(redactUrlsForTest('失败位置 RestoreEngine.ts:108；读取 tabs.settings.v1')).toBe(
      '失败位置 RestoreEngine.ts:108；读取 tabs.settings.v1'
    );
  });

  it('诊断入口在写入 message 前脱敏 URL 并保留其余上下文', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    logDegraded('test', '恢复 https://private.example/account 失败；位置 RestoreEngine.ts:108');

    expect(readDiagnostics().at(-1)?.message).toBe('恢复 <url> 失败；位置 RestoreEngine.ts:108');
  });

  it('失败日志 message 也在入口统一脱敏', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logFailure('test', '访问 https://private.example/account 失败');

    expect(readDiagnostics().at(-1)?.message).toBe('访问 <url> 失败');
  });
});
