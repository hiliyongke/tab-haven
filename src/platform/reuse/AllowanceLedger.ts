/**
 * 豁免账本：为"显式要求保留副本"的场景发放一次性授权令牌。
 *
 * 用途（行为规格，PRD 附录 C-7）：用户显式复制标签、撤销恢复时，目标 URL
 * 获得一次"豁免复用"授权；复用引擎消费令牌后放行新标签，不再合并。
 *
 * 设计：以 `${windowId}:${url}` 为键的令牌桶；令牌带过期时间（惰性清理），
 * 授权计数可叠加。grant 与 consume 语义与具体业务解耦。
 */

interface Allowance {
  tokens: number;
  expiresAt: number;
}

interface AllowanceLedgerOptions {
  /** 令牌有效期（毫秒），默认 10_000。 */
  ttlMs?: number;
  /** 时钟源（测试注入）。 */
  now?: () => number;
}

export class AllowanceLedger {
  private readonly allowances = new Map<string, Allowance>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: AllowanceLedgerOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  private static keyOf(windowId: number, url: string): string {
    return `${windowId}:${url}`;
  }

  /** 发放一枚豁免令牌。 */
  grant(windowId: number, url: string): void {
    this.sweepExpired();
    const key = AllowanceLedger.keyOf(windowId, url);
    const allowance = this.allowances.get(key) || { tokens: 0, expiresAt: 0 };
    allowance.tokens += 1;
    allowance.expiresAt = this.now() + this.ttlMs;
    this.allowances.set(key, allowance);
  }

  /** 尝试消费一枚令牌；无有效令牌返回 false。 */
  consume(windowId: number, url: string): boolean {
    this.sweepExpired();
    const key = AllowanceLedger.keyOf(windowId, url);
    const allowance = this.allowances.get(key);
    if (!allowance) return false;

    allowance.tokens -= 1;
    if (allowance.tokens <= 0) {
      this.allowances.delete(key);
    } else {
      this.allowances.set(key, allowance);
    }
    return true;
  }

  /** 惰性清理过期令牌。 */
  private sweepExpired(): void {
    const now = this.now();
    for (const [key, allowance] of this.allowances) {
      if (allowance.expiresAt <= now || allowance.tokens <= 0) {
        this.allowances.delete(key);
      }
    }
  }
}
