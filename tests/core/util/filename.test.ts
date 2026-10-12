import { afterEach, describe, expect, it, vi } from 'vitest';
import { datedJsonFilename } from '@/core/util/filename';

/**
 * 行为规格：导出文件名。
 *
 * 日期取**本地日期**（`getFullYear/getMonth/getDate`），不是 `toISOString` 的
 * UTC 日期：UTC 日期在东八区早上 8 点前、西半球傍晚之后都与用户看到的「今天」
 * 差一天 —— 导出文件名与预期不符，同一天导出两次还会互相覆盖。
 *
 * 用例刻意用「本地时间构造器」`new Date(y, m, d, ...)` 注入：无论 CI 跑在什么
 * 时区，本地日期都稳定；而改用 UTC 口径的实现在东八区会在第二个用例上失败，
 * 因此这组断言能真正锁住「本地日期」这条语义。
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('datedJsonFilename', () => {
  it('拼出「前缀-日期.json」', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0));

    expect(datedJsonFilename('tabs-backup')).toBe('tabs-backup-2026-09-30.json');
  });

  it('按本地时区取当天（不是 UTC 日期）', () => {
    // 本地 2026-10-01 07:00：东八区此刻 UTC 仍是 09-30，按 UTC 取会差一天。
    expect(datedJsonFilename('tabs-backup', new Date(2026, 9, 1, 7, 0, 0))).toBe(
      'tabs-backup-2026-10-01.json'
    );
  });

  it('月与日补零（单位数不写成 2026-1-5）', () => {
    expect(datedJsonFilename('tabs-backup', new Date(2026, 0, 5))).toBe(
      'tabs-backup-2026-01-05.json'
    );
  });
});
