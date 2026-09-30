import { afterEach, describe, expect, it, vi } from 'vitest';
import { datedJsonFilename } from '@/core/util/filename';

/**
 * 行为规格：导出文件名。
 *
 * 日期取本地宿主的 UTC 日期串（`toISOString` 前 10 位），与旧实现同口径 ——
 * 这里锁的是「前缀 + 日期 + 扩展名」的形状，避免迁移到 core 后悄悄换格式。
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('datedJsonFilename', () => {
  it('拼出「前缀-日期.json」', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));

    expect(datedJsonFilename('tabs-backup')).toBe('tabs-backup-2026-09-30.json');
  });

  it('日期按 UTC 取当天（跨时区不产生前一天的日期）', () => {
    vi.useFakeTimers();
    // 北京时间 2026-10-01 08:00 = UTC 2026-09-30 24:00 前，仍是 09-30
    vi.setSystemTime(new Date('2026-10-01T00:30:00Z'));

    expect(datedJsonFilename('tabs-backup')).toBe('tabs-backup-2026-10-01.json');
  });
});
