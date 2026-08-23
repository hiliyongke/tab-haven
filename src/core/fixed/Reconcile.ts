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

  const next = folders.map((folder) => {
    const items: FixedFolderItem[] = [];
    for (const item of folder.items) {
      let current = item;
      if (current.pendingTabId !== undefined) {
        const tab = tabs.find((candidate) => candidate.id === current.pendingTabId);
        if (tab) {
          const key = webComparisonKey(tab.url, tab.pendingUrl);
          if (key) {
            // 转正：写入真实网址信息
            current = {
              ...current,
              url: key,
              title: tab.title || key,
              favIconUrl: tab.favIconUrl,
              pendingTabId: undefined
            };
            changed = true;
          } else if (tab.title && tab.title !== current.title) {
            // 导航未完成：实时同步标题/图标
            current = { ...current, title: tab.title, favIconUrl: tab.favIconUrl };
            changed = true;
          }
        } else {
          // 挂起标签已关闭：条目移除
          changed = true;
          continue;
        }
      }

      if (!current.pendingTabId && current.url) {
        if (seenUrls.has(current.url)) {
          // 全局唯一：重复条目移除
          changed = true;
          continue;
        }
        seenUrls.add(current.url);
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

  // 清理失效绑定（item 或 tab 已不存在）
  for (const [itemId, tabId] of Object.entries(bindings)) {
    if (itemIds.has(itemId) && tabIds.has(tabId)) {
      next[itemId] = tabId;
      boundTabIds.add(tabId);
    } else {
      changed = true;
    }
  }

  // 为未绑定且非挂起的条目寻找精确 URL 匹配的未占用标签
  for (const folder of folders) {
    for (const item of folder.items) {
      if (item.pendingTabId !== undefined) continue;
      if (next[item.id]) continue;
      if (!item.url) continue;
      const match = tabs.find(
        (tab) =>
          tab.url === item.url &&
          !tab.pinned &&
          !boundTabIds.has(tab.id) &&
          !tab.incognito
      );
      if (match) {
        next[item.id] = match.id;
        boundTabIds.add(match.id);
        changed = true;
      }
    }
  }

  return { bindings: next, changed };
}
