/**
 * 豁免账本：为「显式要求保留副本」的场景发放一次性授权令牌。
 * 用户显式复制标签或撤销恢复时，目标 URL 获得一次豁免，复用引擎消费令牌后不再合并。
 *
 * 以 `${windowId}:${url}` 为键的令牌桶，令牌带过期时间（惰性清理），授权计数可叠加。
 *
 * 令牌经 onMutate 快照镜像到 chrome.storage.session：Service Worker 被回收后
 * 由 restore 合并未过期令牌，否则授权发放与消费之间发生回收会让恢复的标签被误合并。
 */

interface Allowance {
  tokens: number;
  expiresAt: number;
}

/** 可序列化的账本快照（storage.session 持久化格式）。 */
export type AllowanceSnapshot = Record<string, Allowance>;

interface AllowanceLedgerOptions {
  /** 令牌有效期（毫秒），默认 10_000。 */
  ttlMs?: number;
  /** 时钟源（测试注入）。 */
  now?: () => number;
  /** 任何状态变更（发放/消费/过期清理）后触发，携带最新可序列化快照。 */
  onMutate?: (snapshot: AllowanceSnapshot) => void;
}

export class AllowanceLedger {
  private readonly allowances = new Map<string, Allowance>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly onMutate?: (snapshot: AllowanceSnapshot) => void;

  constructor(options: AllowanceLedgerOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.onMutate = options.onMutate;
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
    this.emit();
  }

  /** 尝试消费一枚令牌；无有效令牌返回 false。 */
  consume(windowId: number, url: string): boolean {
    const changed = this.sweepExpired();
    const key = AllowanceLedger.keyOf(windowId, url);
    const allowance = this.allowances.get(key);
    if (!allowance) {
      if (changed) this.emit();
      return false;
    }

    allowance.tokens -= 1;
    if (allowance.tokens <= 0) {
      this.allowances.delete(key);
    } else {
      this.allowances.set(key, allowance);
    }
    this.emit();
    return true;
  }

  /** 当前账本的可序列化快照（深拷贝，调用方可安全持久化）。 */
  snapshot(): AllowanceSnapshot {
    const out: AllowanceSnapshot = {};
    for (const [key, allowance] of this.allowances) {
      out[key] = { tokens: allowance.tokens, expiresAt: allowance.expiresAt };
    }
    return out;
  }

  /**
   * 从快照恢复（合并语义，不覆盖内存中更新的授权）：
   * 逐键取「令牌数更多」的一方，过期项（expiresAt 已过）直接丢弃。
   * 供 SW 重启后从 storage.session 恢复使用。
   */
  restore(snapshot: AllowanceSnapshot): void {
    const now = this.now();
    let changed = false;
    for (const [key, incoming] of Object.entries(snapshot)) {
      if (
        typeof incoming?.tokens !== 'number' ||
        typeof incoming?.expiresAt !== 'number' ||
        incoming.tokens <= 0 ||
        incoming.expiresAt <= now
      ) {
        continue;
      }
      const current = this.allowances.get(key);
      if (!current || incoming.tokens > current.tokens) {
        this.allowances.set(key, { tokens: incoming.tokens, expiresAt: incoming.expiresAt });
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** 惰性清理过期令牌；返回是否发生了删除。 */
  private sweepExpired(): boolean {
    const now = this.now();
    let changed = false;
    for (const [key, allowance] of this.allowances) {
      if (allowance.expiresAt <= now || allowance.tokens <= 0) {
        this.allowances.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  /** 状态变更通知（携带最新快照；持久化方负责落盘）。 */
  private emit(): void {
    if (!this.onMutate) return;
    this.onMutate(this.snapshot());
  }
}
