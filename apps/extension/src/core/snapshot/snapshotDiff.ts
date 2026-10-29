import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { isHttpUrl, webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 快照恢复 diff：口径严格镜像 missingTabsOf——仅 http(s)；快照键 webComparisonKey(url, undefined) ?? url；
 * 窗口键 webComparisonKey(url, pendingUrl)；快照内重复同键留首条。两处漂移会导致预览与实际恢复不符。
 */

/** 单条快照条目的 diff 分类。 */
type SnapshotDiffStatus = 'create' | 'existing' | 'skipped';

/** diff 结果条目：原条目 + 分类。 */
interface SnapshotDiffEntry {
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

/** @param existingKeys 当前窗口已打开 URL 的 web 比较键集合。 */
export function snapshotDiff(
  tabs: readonly SnapshotTab[],
  existingKeys: ReadonlySet<string>
): SnapshotDiffResult {
  const willCreate: SnapshotDiffEntry[] = [];
  const existing: SnapshotDiffEntry[] = [];
  const skipped: SnapshotDiffEntry[] = [];
  const seen = new Set<string>();

  for (const tab of tabs) {
    // 不可恢复：非 http(s)（采集端已过滤，此处兜底导入数据）。
    if (!isHttpUrl(tab.url)) {
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

/** 构造选择性恢复的部分快照（tabCount 随勾选条目重算，满足 schema refine 约束）。 */
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
