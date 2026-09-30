import { describe, expect, it } from 'vitest';
import { redactUrlsForTest as r } from '@/platform/diagnostics';

/** 脱敏不得误伤非 URL 文本（R17 / S-2 的反向约束）。 */
describe('redactUrls 误伤防护', () => {
  it('时间串不被脱敏', () => {
    expect(r('at 12:30 today')).toBe('at 12:30 today');
    expect(r('2026-09-30 15:20 failed')).toBe('2026-09-30 15:20 failed');
  });
  it('文件名:行号 不被脱敏', () => {
    expect(r('file.ts:42 error')).toBe('file.ts:42 error');
  });
  it('版本号不被脱敏', () => {
    expect(r('node v22.1.0')).toBe('node v22.1.0');
  });
  it('无端口的冒号短语不被脱敏', () => {
    expect(r('operation failed: no such tab')).toBe('operation failed: no such tab');
  });
});
