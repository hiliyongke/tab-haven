import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 固定空间一致性协调（纯函数）：挂起条目转正（导航为 web 页后写入真实 url/title/favicon）
 * 与会话绑定维护（清失效绑定、为未绑定条目找精确 URL 匹配的未占用标签）。
 */

interface ReconcileResult {
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
  // 预建索引避免内层 tabs.find 的 O(条目×标签)。
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
            // 转正。favicon 未就绪时保留旧值，否则 undefined 会清空已显示图标。
            current = {
              ...current,
              url: tab.url || key,
              title: tab.title || key,
              favIconUrl: tab.favIconUrl ?? current.favIconUrl,
              pendingTabId: undefined
            };
            changed = true;
          } else {
            // 导航未完成：仅同步标题/图标（标题为空保留旧值）。
            const title = tab.title || current.title;
            const favIconUrl = tab.favIconUrl ?? current.favIconUrl;
            if (title !== current.title || favIconUrl !== current.favIconUrl) {
              current = { ...current, title, favIconUrl };
              changed = true;
            }
          }
        } else {
          changed = true;
          continue;
        }
      }

      if (!current.pendingTabId && current.url) {
        // 用 webComparisonKey 归一，裸字符串比较会让大小写/默认端口差异绕过唯一性。
        const key = webComparisonKey(current.url, undefined) ?? current.url;
        if (seenUrls.has(key)) {
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

  // 清失效绑定；同一 tab 被多条目占用时保留首条，维护「一个 tab 只服务一个条目」。
  for (const [itemId, tabId] of Object.entries(bindings)) {
    if (itemIds.has(itemId) && tabIds.has(tabId) && !boundTabIds.has(tabId)) {
      next[itemId] = tabId;
      boundTabIds.add(tabId);
    } else {
      changed = true;
    }
  }

  const candidatesByKey = new Map<string, TabRecord[]>();
  for (const tab of tabs) {
    if (tab.pinned || tab.incognito) continue;
    const key = webComparisonKey(tab.url, tab.pendingUrl);
    if (key === null) continue;
    const list = candidatesByKey.get(key);
    if (list) list.push(tab);
    else candidatesByKey.set(key, [tab]);
  }

  // 游标单向推进（boundTabIds 只增不减），避免同键多标签时退化为 O(N²)。
  const cursorByKey = new Map<string, number>();

  for (const folder of folders) {
    for (const item of folder.items) {
      if (item.pendingTabId !== undefined) continue;
      // 用 !== undefined：tabId=0 时用真值判断会误判为未绑定，导致同一标签被重复绑定。
      if (next[item.id] !== undefined) continue;
      if (!item.url) continue;
      const key = webComparisonKey(item.url, undefined);
      if (key === null) continue;
      const list = candidatesByKey.get(key);
      if (list === undefined) continue;
      let cursor = cursorByKey.get(key) ?? 0;
      while (cursor < list.length && boundTabIds.has(list[cursor]!.id)) cursor += 1;
      cursorByKey.set(key, cursor);
      const match = cursor < list.length ? list[cursor] : undefined;
      if (match) {
        next[item.id] = match.id;
        boundTabIds.add(match.id);
        changed = true;
      }
    }
  }

  return { bindings: next, changed };
}
