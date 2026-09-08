import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 固定空间一致性协调（纯函数）：
 *  - 挂起条目转正：pendingTabId 对应标签导航为 web 页后，条目写入
 *    url/title/favicon 并删除 pendingTabId（全局去重同 URL 条目）；
 *  - 会话绑定维护：清理失效绑定，为未绑定条目寻找精确 URL 匹配的未占用标签。
 */

export interface ReconcileResult {
  folders: FixedFolder[];
  changed: boolean;
}

/** 挂起条目转正 + URL 全局唯一。 */
export function reconcilePendingItems(
  folders: FixedFolder[],
  tabs: readonly TabRecord[]
): ReconcileResult {
  let changed = false;
  const seenUrls = new Set<string>();
  // 预建标签索引：原先在「文件夹 × 条目」的内层循环里 tabs.find(...)，
  // 复杂度 O(条目数 × 标签数)。该函数每次标签事件都会跑（上限 200 文件夹 × 500 条目），
  // 是全应用最值得消除的一处热点。
  const tabById = new Map<number, TabRecord>();
  for (const tab of tabs) tabById.set(tab.id, tab);

  const next = folders.map((folder) => {
    const items: FixedFolderItem[] = [];
    for (const item of folder.items) {
      let current = item;
      if (current.pendingTabId !== undefined) {
        const tab = tabById.get(current.pendingTabId);
        if (tab) {
          const key = webComparisonKey(tab.url, tab.pendingUrl);
          if (key) {
            // 转正：写入真实网址信息
            current = {
              ...current,
              // 优先保留标签真实完整 URL（含 query/fragment）；key 为归一化结果，仅在无真实 URL 时降级使用。
              url: tab.url || key,
              title: tab.title || key,
              favIconUrl: tab.favIconUrl,
              pendingTabId: undefined
            };
            changed = true;
          } else if (
            (tab.title && tab.title !== current.title) ||
            tab.favIconUrl !== current.favIconUrl
          ) {
            // 导航未完成：实时同步标题/图标（仅 favicon 变化也要同步；标题为空时保留旧值）
            current = {
              ...current,
              title: tab.title || current.title,
              favIconUrl: tab.favIconUrl
            };
            changed = true;
          }
        } else {
          // 挂起标签已关闭：条目移除
          changed = true;
          continue;
        }
      }

      if (!current.pendingTabId && current.url) {
        // 与固定空间其余去重路径同口径（webComparisonKey）：裸字符串比较会让
        // 大小写/默认端口不同的同一 URL 判成两个，唯一性约束形同虚设。
        const key = webComparisonKey(current.url, undefined) ?? current.url;
        if (seenUrls.has(key)) {
          // 全局唯一：重复条目移除
          changed = true;
          continue;
        }
        seenUrls.add(key);
      }
      items.push(current);
    }
    return { ...folder, items };
  });

  return { folders: next, changed };
}

/** 绑定维护：清理失效 + 自动建立精确匹配。 */
export function reconcileBindings(
  folders: FixedFolder[],
  tabs: readonly TabRecord[],
  bindings: Record<string, number>
): { bindings: Record<string, number>; changed: boolean } {
  const itemIds = new Set(folders.flatMap((folder) => folder.items.map((item) => item.id)));
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const boundTabIds = new Set<number>();
  const next: Record<string, number> = {};
  let changed = false;

  // 清理失效绑定（item 或 tab 已不存在）；同一 tab 被多个条目占用时
  // 保留首条（插入序），丢弃其余，维护「一个 tab 只服务一个条目」不变量。
  for (const [itemId, tabId] of Object.entries(bindings)) {
    if (itemIds.has(itemId) && tabIds.has(tabId) && !boundTabIds.has(tabId)) {
      next[itemId] = tabId;
      boundTabIds.add(tabId);
    } else {
      changed = true;
    }
  }

  // 可绑定标签按比较键索引：原先在双层循环里 tabs.find(...)，复杂度 O(条目 × 标签)。
  const candidatesByKey = new Map<string, TabRecord[]>();
  for (const tab of tabs) {
    if (tab.pinned || tab.incognito) continue;
    const key = webComparisonKey(tab.url, tab.pendingUrl);
    if (key === null) continue;
    const list = candidatesByKey.get(key);
    if (list) list.push(tab);
    else candidatesByKey.set(key, [tab]);
  }

  // 为未绑定且非挂起的条目寻找精确 URL 匹配的未占用标签
  for (const folder of folders) {
    for (const item of folder.items) {
      if (item.pendingTabId !== undefined) continue;
      // 必须用 !== undefined：tabId 为 0 时真值判断会误判为「未绑定」，
      // 导致同一标签被重复绑定，破坏「一个 tab 只服务一个条目」不变量。
      if (next[item.id] !== undefined) continue;
      if (!item.url) continue;
      const key = webComparisonKey(item.url, undefined);
      if (key === null) continue;
      const match = candidatesByKey.get(key)?.find((tab) => !boundTabIds.has(tab.id));
      if (match) {
        next[item.id] = match.id;
        boundTabIds.add(match.id);
        changed = true;
      }
    }
  }

  return { bindings: next, changed };
}
