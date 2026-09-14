import { SNAPSHOT_TABS_LIMIT } from '@/core/schema/models';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';

/**
 * 时间线搜索索引构建（P-01）：把快照条目映射进 SearchEngine 的可搜目标。
 *
 * 合成 id 方案：真实 tab id 为非负整数，快照条目用**负数区间**编码，
 * 两类 id 永不冲突。id 编码规则（由 `decodeHistoryId` 用同一公式反解）：
 *
 *   id = -(index + 1)，index = snapshotIndex * HISTORY_TABS_PER_SNAPSHOT + tabIndex
 *
 * 其中 snapshotIndex 是**按创建时间降序**的快照序号（0 = 最新），tabIndex 是快照内
 * 条目序号。条目身份完全由 id 编码承载，解码端无需任何映射表存储。
 *
 * 索引上限：只索引最近 N 份快照（默认 20 份），防快照积累把搜索性能回归测试击穿
 * （PRODUCT-ANALYSIS P-01 风险节的明确要求）。
 */

/** 时间线索引覆盖的最近快照份数上限（性能护栏）。 */
export const HISTORY_SNAPSHOT_LIMIT = 20;
/** 编码基：每份快照条目数上限。直接派生自 SNAPSHOT_TABS_LIMIT，结构上保证索引空间无碰撞。 */
export const HISTORY_TABS_PER_SNAPSHOT = SNAPSHOT_TABS_LIMIT;

/** 可注入 SearchEngine 的目标形态（与 SearchableTab 结构一致，字段见 SearchEngine.ts）。 */
export interface HistorySearchTarget {
  id: number;
  title: string;
  url: string;
  active: false;
}

/** 单条历史命中（解码后的结构化结果）。 */
export interface HistoryHitInfo {
  snapshotId: string;
  snapshotIndex: number;
  tabIndex: number;
  snapshotName: string;
  snapshotOrigin: Snapshot['origin'];
  snapshotCreatedAt: number;
  /** 所属快照的标签总数（恢复动作提示文案用）。 */
  snapshotTabCount: number;
  tab: SnapshotTab;
}

/** 按创建时间降序取最近 limit 份快照（build 与 decode 共用同一顺序口径）。 */
function recentSnapshots(snapshots: readonly Snapshot[], limit: number): Snapshot[] {
  return [...snapshots].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** 由快照列表构建历史搜索目标（按创建时间降序，取最近 limit 份）。 */
export function buildHistoryTargets(
  snapshots: readonly Snapshot[],
  limit = HISTORY_SNAPSHOT_LIMIT
): HistorySearchTarget[] {
  const ordered = recentSnapshots(snapshots, limit);
  const targets: HistorySearchTarget[] = [];
  for (let snapshotIndex = 0; snapshotIndex < ordered.length; snapshotIndex++) {
    const snap = ordered[snapshotIndex]!;
    for (let tabIndex = 0; tabIndex < snap.tabs.length; tabIndex++) {
      const tab = snap.tabs[tabIndex]!;
      targets.push({
        id: -(snapshotIndex * HISTORY_TABS_PER_SNAPSHOT + tabIndex + 1),
        title: tab.title || tab.url,
        url: tab.url,
        active: false as const
      });
    }
  }
  return targets;
}

/** 反解合成 id：非历史 id（>= 0 或越界）返回 null。 */
export function decodeHistoryId(
  id: number,
  snapshots: readonly Snapshot[],
  limit = HISTORY_SNAPSHOT_LIMIT
): HistoryHitInfo | null {
  if (id >= 0) return null;
  const index = -id - 1;
  const snapshotIndex = Math.floor(index / HISTORY_TABS_PER_SNAPSHOT);
  const tabIndex = index % HISTORY_TABS_PER_SNAPSHOT;
  const snap = recentSnapshots(snapshots, limit)[snapshotIndex];
  if (!snap) return null;
  const tab = snap.tabs[tabIndex];
  if (!tab) return null;
  return {
    snapshotId: snap.id,
    snapshotIndex,
    tabIndex,
    snapshotName: snap.name,
    snapshotOrigin: snap.origin,
    snapshotCreatedAt: snap.createdAt,
    snapshotTabCount: snap.tabCount,
    tab
  };
}
