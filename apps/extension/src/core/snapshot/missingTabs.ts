import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { isHttpUrl, webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 恢复快照中「窗口内尚未打开」的条目（web 比较键去重；快照内自身重复也去重）。
 *
 * 口径与 `core/snapshot/snapshotDiff` 严格镜像（比较键 / 仅 http(s) / 快照内去重），
 * 两处漂移会出现「预览说会新建 3 条、实际恢复新建 5 条」的失信预览。
 */
export function missingTabsOf(
  snapshot: Snapshot,
  existingKeys: ReadonlySet<string>
): SnapshotTab[] {
  const seen = new Set<string>();
  const missing: SnapshotTab[] = [];
  for (const tab of snapshot.tabs) {
    // 仅 http(s) 条目可恢复（chrome:// 等内部页浏览器不允许以 URL 创建，采集端已过滤，
    // 此处兜底导入数据）。
    if (!isHttpUrl(tab.url)) continue;
    const key = webComparisonKey(tab.url, undefined) ?? tab.url;
    if (existingKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push(tab);
  }
  return missing;
}
