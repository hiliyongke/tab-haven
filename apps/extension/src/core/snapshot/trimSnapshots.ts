import type { Settings, Snapshot } from '@/core/schema/models';

/**
 * 快照裁剪：先保证自动快照不超过 maxAutoSnapshots（仅保留最新 N 条 auto），
 * 再保证总快照不超过 snapshotLimit（保留最新 N 条）。返回新数组（不修改入参），
 * 并附带被淘汰的快照。
 *
 * 「告知用户」属于 UI 反馈，core 层没有 notify 通道，因此契约是**返回值**：
 * 精确的淘汰项交给调用方（platform 落盘后经监听方上抛）。
 */
export function trimSnapshotsWithEvicted(
  list: readonly Snapshot[],
  settings: Settings
): { kept: Snapshot[]; evicted: Snapshot[] } {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const maxAuto = Math.max(1, settings.maxAutoSnapshots);
  const autoSorted = sorted.filter((s) => s.origin === 'auto');
  const autoEvicted = autoSorted.slice(maxAuto);
  const autoKept = autoSorted.slice(0, maxAuto);
  // 上限只对「非自动」快照生效：snapshotLimit 的语义是「命名快照 / 归档 / 工作区的
  // 保留上限」，auto 侧已由 maxAutoSnapshots 独立收敛。两族合流后再统一 slice，
  // 会让手动快照占满额度时把旧 auto 一并挤掉 —— 而 auto 恰恰是崩溃兜底那一族，
  // 被自己不该竞争的额度淘汰即「兜底快照凭空消失」。
  const manualSorted = sorted.filter((s) => s.origin !== 'auto');
  const limit = Math.max(1, settings.snapshotLimit);
  const manualKept = manualSorted.slice(0, limit);
  const manualEvicted = manualSorted.slice(limit);
  const kept = [...autoKept, ...manualKept].sort((x, y) => y.createdAt - x.createdAt);
  return { kept, evicted: [...autoEvicted, ...manualEvicted] };
}
