import { browser } from 'wxt/browser';
import { z } from 'zod';
import { AllowanceLedger, type AllowanceSnapshot } from '@/core/reuse/AllowanceLedger';
import { logDegraded } from '@/platform/diagnostics';
import { ALLOWANCE_KEY } from '@/platform/storage/keys';

/** 镜像内容的校验 schema。storage.session 里的值同属持久化数据，按架构约定必须经 zod 校验。 */
const AllowanceSnapshotSchema = z.record(
  z.string(),
  z.object({ tokens: z.number().finite(), expiresAt: z.number().finite() })
);

/**
 * 持久化豁免账本（MV3 SW 回收防护）。内存账本为主（热路径同步消费），storage.session 为镜像：
 * - 任何发放/消费/过期清理 → 快照落盘（storage.session 为内存映射，读写廉价）；
 * - SW 重新拉起 → ready 从镜像恢复未过期令牌（合并语义，见 AllowanceLedger.restore）；
 * - 恢复完成前到达的发放先暂存快照、恢复后一次性落盘，避免「恢复读-写」与「发放写」互相覆盖。
 * 降级：storage.session 不可用时退化为纯内存行为。
 */

// 键名见 @/platform/storage/keys（全仓存储键的唯一声明处）。

interface PersistedAllowanceLedger {
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
    // 即时 fire-and-forget 落盘：storage 对同一 key 的写入按调用顺序应用，本上下文内天然串行，
    // 无需额外串行链（串行链反而会引入「消费后镜像仍含已消费令牌」的微任务窗口——SW 恰在窗口内
    // 重启会复活令牌）。跨上下文的整快照覆盖由 AllowanceLedger.restore 的合并语义（取 max tokens）兜底。
    void sessionArea.set({ [ALLOWANCE_KEY]: snapshot }).catch(() => {
      // 配额/存储异常：镜像尽力而为，失败静默（内存账本仍有效）
    });
  };

  const ledger = new AllowanceLedger({ onMutate: flush });

  const ready = (async () => {
    if (!sessionArea) return;
    try {
      const record = await sessionArea.get(ALLOWANCE_KEY);
      const parsed = AllowanceSnapshotSchema.safeParse(record[ALLOWANCE_KEY]);
      if (parsed.success) {
        ledger.restore(parsed.data);
      } else if (record[ALLOWANCE_KEY] !== undefined) {
        // 只记问题条数与 issue.code，不传 error 对象：本 schema 的 key 是 `${windowId}:${url}`，
        // zod 会把 path 序列化进 error.message —— 进诊断日志就等于把浏览过的 URL 写进可导出的
        // 诊断文件，违反「不记录 URL」的承诺。
        const codes = parsed.error.issues.map((issue) => issue.code).join(',') || 'unknown';
        logDegraded(
          'reuse',
          `复用账本镜像校验失败（${parsed.error.issues.length} 处：${codes}），已按空账本启动`
        );
      }
    } catch (error) {
      logDegraded('reuse', '复用账本持久化读取失败', error);
      // 读取失败：以空账本启动
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
