import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 快照恢复 diff：把「恢复会发生什么」变成决策前可见的纯函数。
 *
 * 口径严格镜像 `platform/snapshot/snapshots.ts` 的私有 `missingTabsOf`：
 *  - 仅 http(s) 条目参与恢复（chrome:// 等内部页浏览器不允许以 URL 创建）；
 *  - 快照条目比较键：`webComparisonKey(url, undefined) ?? url`；
 *  - 窗口侧比较键：`webComparisonKey(url, pendingUrl)`；
 *  - 快照内自身重复也去重（同键保留首条）。
 *
 * 若两处口径漂移，会出现「预览说会新建 3 条、实际恢复新建 5 条」的失信预览。
 * 行为规格测试（tests/core/snapshot/snapshot-diff.test.ts）锁住这一契约。
 */

/** 单条快照条目的 diff 分类。 */
export type SnapshotDiffStatus = 'create' | 'existing' | 'skipped';

/** diff 结果条目：原条目 + 分类。 */
export interface SnapshotDiffEntry {
  tab: SnapshotTab;
  status: SnapshotDiffStatus;
}

/** diff 结果：三分类 + 计数（计数由条目派生，供 UI 直接展示）。 */
export interface SnapshotDiffResult {
  /** 将在窗口新建的条目（快照内去重后仍缺失）。 */
  willCreate: SnapshotDiffEntry[];
  /** 窗口内已存在同比较键的条目（恢复时跳过，已有标签不动）。 */
  existing: SnapshotDiffEntry[];
  /** 不可恢复条目（非 http(s) 内部页）与快照内重复条目。 */
  skipped: SnapshotDiffEntry[];
  counts: { create: number; existing: number; skipped: number };
}

/** 快照条目的比较键（missingTabsOf 同口径：非 web 页回退原始 URL 字符串）。 */
function snapshotTabKey(tab: SnapshotTab): string {
  return webComparisonKey(tab.url, undefined) ?? tab.url;
}

/**
 * 计算快照条目相对当前窗口的恢复 diff。
 *
 * @param tabs 快照条目（快照.tabs 原样传入）
 * @param existingKeys 当前窗口已打开 URL 的 web 比较键集合
 *   （窗口侧口径：`webComparisonKey(tab.url, tab.pendingUrl)`，非 null 才入集合）
 */
export function snapshotDiff(
  tabs: readonly SnapshotTab[],
  existingKeys: ReadonlySet<string>
): SnapshotDiffResult {
  const willCreate: SnapshotDiffEntry[] = [];
  const existing: SnapshotDiffEntry[] = [];
  const skipped: SnapshotDiffEntry[] = [];
  const seen = new Set<string>();

  for (const tab of tabs) {
    // 不可恢复：非 http(s)（采集端已过滤，此处兜底旧数据 / 导入数据）。
    if (!/^https?:\/\//i.test(tab.url)) {
      skipped.push({ tab, status: 'skipped' });
      continue;
    }
    const key = snapshotTabKey(tab);
    // 快照内自身重复：同键保留首条，后续条目计入 skipped。
    if (seen.has(key)) {
      skipped.push({ tab, status: 'skipped' });
      continue;
    }
    seen.add(key);
    if (existingKeys.has(key)) {
      existing.push({ tab, status: 'existing' });
    } else {
      willCreate.push({ tab, status: 'create' });
    }
  }

  return {
    willCreate,
    existing,
    skipped,
    counts: { create: willCreate.length, existing: existing.length, skipped: skipped.length }
  };
}

/**
 * 构造选择性恢复的「部分快照」：用勾选后的条目重建一份满足 schema refine 约束
 * （tabCount === tabs.length）的快照，复用整份恢复管线 restoreSnapshot。
 *
 * 非勾选条目直接丢弃（既不恢复也不新建），tabCount 同步重算。
 */
export function buildPartialSnapshot(
  snapshot: Snapshot,
  selectedTabs: readonly SnapshotTab[]
): Snapshot {
  return {
    ...snapshot,
    tabs: [...selectedTabs],
    tabCount: selectedTabs.length
  };
}
