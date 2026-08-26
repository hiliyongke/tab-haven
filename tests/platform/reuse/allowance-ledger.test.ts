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

  it('snapshot/restore 往返：快照可恢复到新账本并正常消费', () => {
    const now = 1_000;
    const source = new AllowanceLedger({ ttlMs: 10_000, now: () => now });
    source.grant(1, 'https://a.com/');
    source.grant(1, 'https://a.com/');
    const snapshot = source.snapshot();

    // 新账本（模拟 SW 回收后重新拉起）从快照恢复
    const revived = new AllowanceLedger({ ttlMs: 10_000, now: () => now });
    revived.restore(snapshot);
    expect(revived.consume(1, 'https://a.com/')).toBe(true);
    expect(revived.consume(1, 'https://a.com/')).toBe(true);
    expect(revived.consume(1, 'https://a.com/')).toBe(false);
  });

  it('restore 丢弃过期令牌（SW 回收超过 TTL 后镜像不复活）', () => {
    let now = 1_000;
    const ledger = new AllowanceLedger({ ttlMs: 10_000, now: () => now });
    ledger.grant(1, 'https://a.com/');
    const snapshot = ledger.snapshot();

    now = 100_000; // 回收期间已超过 TTL
    const revived = new AllowanceLedger({ ttlMs: 10_000, now: () => now });
    revived.restore(snapshot);
    expect(revived.consume(1, 'https://a.com/')).toBe(false);
  });

  it('restore 合并语义：不覆盖内存中更新的授权（恢复与新发放并发安全）', () => {
    let now = 1_000;
    const ledger = new AllowanceLedger({ ttlMs: 10_000, now: () => now });
    ledger.grant(1, 'https://a.com/');
    const stale = ledger.snapshot(); // 镜像读到的旧快照

    now = 2_000;
    ledger.grant(1, 'https://a.com/'); // 恢复完成前又有新发放（内存 2 枚）
    ledger.restore(stale); // 迟到的恢复不得把内存拉回 1 枚
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);
    expect(ledger.consume(1, 'https://a.com/')).toBe(true);
    expect(ledger.consume(1, 'https://a.com/')).toBe(false);
  });

  it('onMutate 在发放/消费/过期清理时携带最新快照', () => {
    let now = 1_000;
    const snapshots: number[] = [];
    const ledger = new AllowanceLedger({
      ttlMs: 10_000,
      now: () => now,
      onMutate: (snapshot) => snapshots.push(Object.values(snapshot)[0]?.tokens ?? 0)
    });
    ledger.grant(1, 'https://a.com/');
    ledger.grant(1, 'https://a.com/');
    ledger.consume(1, 'https://a.com/');
    now = 100_000;
    ledger.consume(1, 'https://a.com/'); // 过期清理（无有效令牌）
    expect(snapshots).toEqual([1, 2, 1, 0]);
  });
});
