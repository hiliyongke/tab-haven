import { browser } from 'wxt/browser';
import { AllowanceLedger, type AllowanceSnapshot } from '@/platform/reuse/AllowanceLedger';

/**
 * 持久化豁免账本（MV3 SW 回收防护，R-A 修复）：
 *
 * 内存账本为主（热路径同步消费），chrome.storage.session 为镜像：
 * - 任何发放/消费/过期清理 → 快照落盘（storage.session 为内存映射，读写廉价）；
 * - SW 重新拉起 → ready 从镜像恢复未过期令牌（合并语义，见 AllowanceLedger.restore）；
 * - 恢复完成前到达的发放会先暂存快照、恢复后一次性落盘，
 *   避免「恢复读-写」与「发放写」互相覆盖。
 *
 * 降级：storage.session 不可用（异常/测试环境）时退化为纯内存行为，与原实现一致。
 */

/** storage.session 镜像键（storage key 唯一出处原则：仓库键见 repositories.ts，SW 专用键沿用 tabhaven. 前缀）。 */
const ALLOWANCE_KEY = 'tabhaven.allowance.v1';

export interface PersistedAllowanceLedger {
  ledger: AllowanceLedger;
  /** SW 启动恢复完成信号；调用方（ReuseCoordinator）应在首次消费前 await。 */
  ready: Promise<void>;
}

/** 创建镜像到 chrome.storage.session 的豁免账本。 */
export function createPersistedAllowanceLedger(): PersistedAllowanceLedger {
  const sessionArea = browser.storage?.session;
  /** 恢复完成标志：之前的变更快照缓存于此，恢复后统一落盘。 */
  let restored = false;
  let pendingFlush: AllowanceSnapshot | undefined;

  const flush = (snapshot: AllowanceSnapshot): void => {
    if (!sessionArea) return;
    if (!restored) {
      // 恢复未完成：仅暂存最新快照（避免覆盖尚未合并进内存的镜像内容）。
      pendingFlush = snapshot;
      return;
    }
    void sessionArea.set({ [ALLOWANCE_KEY]: snapshot }).catch(() => {
      // 配额/存储异常：镜像尽力而为，失败静默（内存账本仍有效）
    });
  };

  const ledger = new AllowanceLedger({ onMutate: flush });

  const ready = (async () => {
    if (!sessionArea) return;
    try {
      const record = await sessionArea.get(ALLOWANCE_KEY);
      const snapshot = record[ALLOWANCE_KEY];
      if (snapshot && typeof snapshot === 'object') {
        ledger.restore(snapshot as AllowanceSnapshot);
      }
    } catch {
      // 读取失败：以空账本启动（与原内存行为一致）
    } finally {
      restored = true;
      // 恢复期间如有发放（暂存于 pendingFlush），恢复完成后一次性落盘。
      if (pendingFlush) {
        const pending = pendingFlush;
        pendingFlush = undefined;
        flush(pending);
      }
    }
  })();

  return { ledger, ready };
}
