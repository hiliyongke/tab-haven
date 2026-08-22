import { describe, expect, it } from 'vitest';
import { AllowanceLedger } from '@/platform/reuse/AllowanceLedger';

/**
 * 行为规格（PRD 附录 C-7）：显式复制/撤销恢复获得豁免授权，授权有
 * 有效期、可叠加、一次性消费。
 */
describe('AllowanceLedger', () => {
  it('grant 后可消费一次，再次消费失败', () => {
    const ledger = new AllowanceLedger();
    ledger.grant(1, 'https://a.com/');
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);
    expect(ledger.consume(1, 'https://a.com/')).toBe(false);
  });

  it('授权按窗口与网址隔离', () => {
    const ledger = new AllowanceLedger();
    ledger.grant(1, 'https://a.com/');
    expect(ledger.consume(2, 'https://a.com/')).toBe(false);
    expect(ledger.consume(1, 'https://b.com/')).toBe(false);
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);
  });

  it('授权可叠加（多次复制消耗多次）', () => {
    const ledger = new AllowanceLedger();
    ledger.grant(1, 'https://a.com/');
    ledger.grant(1, 'https://a.com/');
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);
    expect(ledger.consume(1, 'https://a.com/')).toBe(false);
  });

  it('过期授权失效（TTL）', () => {
    let now = 1_000;
    const ledger = new AllowanceLedger({ ttlMs: 10_000, now: () => now });
    ledger.grant(1, 'https://a.com/');

    now = 10_999; // 有效期边界内
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);

    ledger.grant(1, 'https://a.com/');
    now = 20_998; // 第二次授权（发放于 10999）过期前一刻
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);

    ledger.grant(1, 'https://a.com/');
    now = 100_000; // 第三次授权已过期
    expect(ledger.consume(1, 'https://a.com/')).toBe(false);
  });

  it('过期令牌惰性清理后新授权可用', () => {
    let now = 1_000;
    const ledger = new AllowanceLedger({ ttlMs: 10_000, now: () => now });
    ledger.grant(1, 'https://a.com/');
    now = 100_000;
    expect(ledger.consume(1, 'https://a.com/')).toBe(false);

    ledger.grant(1, 'https://a.com/');
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);
  });
});
