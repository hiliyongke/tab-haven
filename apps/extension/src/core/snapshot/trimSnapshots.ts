import type { Settings, Snapshot } from '@/core/schema/models';

/** 快照裁剪：auto 受 maxAutoSnapshots 约束、其余受 snapshotLimit 约束，返回保留项与被淘汰项供上层提示。 */
export function trimSnapshotsWithEvicted(
  list: readonly Snapshot[],
  settings: Settings
): { kept: Snapshot[]; evicted: Snapshot[] } {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const maxAuto = Math.max(1, settings.maxAutoSnapshots);
  const autoSorted = sorted.filter((s) => s.origin === 'auto');
  const autoEvicted = autoSorted.slice(maxAuto);
  const autoKept = autoSorted.slice(0, maxAuto);
  // auto 由 maxAutoSnapshots 独立收敛，不与手动快照争 snapshotLimit；否则旧 auto（崩溃兜底）会被挤掉。
  const manualSorted = sorted.filter((s) => s.origin !== 'auto');
  const limit = Math.max(1, settings.snapshotLimit);
  const manualKept = manualSorted.slice(0, limit);
  const manualEvicted = manualSorted.slice(limit);
  const kept = [...autoKept, ...manualKept].sort((x, y) => y.createdAt - x.createdAt);
  return { kept, evicted: [...autoEvicted, ...manualEvicted] };
}
