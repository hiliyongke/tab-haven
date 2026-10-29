import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 全量标签 → 条目匹配索引（按 tabs 数组引用做模块级缓存）。
 * N 个 FolderRow 各自建索引是 N×O(标签) 的重复劳动；索引内容只取决于 tabs 引用，缓存后每次快照全局只建一次。
 *
 * 与 `@/ui/tabs/pinRuntime` 的 `buildPinRuntimeIndex` 是**两套**索引，不要合并：
 * 那个按 pin 身份（去参 URL）索引到磁贴运行时，本索引按完整比较键 / 原始 URL / tabId 索引到标签记录。
 */
export interface TabRuntimeIndex {
  byKey: Map<string, TabRecord>;
  byRawUrl: Map<string, TabRecord>;
  byId: Map<number, TabRecord>;
}

/**
 * 容量 2 的 LRU（队首 = 最近使用）。
 * 单槽缓存不够：A/B 两个 tabs 引用**交替**命中时（如「本窗口」与「全窗口搜索」两种快照轮流传给
 * FolderRow）每次都未命中，索引被反复重建。容量 2 覆盖交替且不随窗口数增长。
 */
const INDEX_CACHE_SIZE = 2;
const indexCache: Array<{ tabs: readonly TabRecord[]; index: TabRuntimeIndex }> = [];

export function getTabRuntimeIndex(tabs: readonly TabRecord[]): TabRuntimeIndex {
  const hitAt = indexCache.findIndex((entry) => entry.tabs === tabs);
  if (hitAt !== -1) {
    const hit = indexCache[hitAt]!;
    indexCache.splice(hitAt, 1);
    indexCache.unshift(hit);
    return hit.index;
  }
  const byKey = new Map<string, TabRecord>();
  const byRawUrl = new Map<string, TabRecord>();
  const byId = new Map<number, TabRecord>();
  for (const tab of tabs) {
    // URL 索引排除隐身标签：与 handleOpenAll / openSavedItem 的匹配口径一致
    // （均含 !tab.incognito）。否则隐身窗口里打开的条目会显示「已打开」，
    // 而「打开全部」仍判其缺失再次打开。byId 保留全量（pendingTabId 是显式绑定）。
    if (tab.url && !tab.incognito) {
      const key = webComparisonKey(tab.url, tab.pendingUrl);
      if (key !== null) byKey.set(key, tab);
      byRawUrl.set(tab.url, tab);
    }
    byId.set(tab.id, tab);
  }
  const built: TabRuntimeIndex = { byKey, byRawUrl, byId };
  indexCache.unshift({ tabs, index: built });
  if (indexCache.length > INDEX_CACHE_SIZE) indexCache.pop();
  return built;
}

/** 未打开条目的运行时状态单例：内联 `{ isOpen: false }` 每次渲染都是新引用，会击穿 memo 叶子。 */
export const CLOSED_RUNTIME = { isOpen: false } as const;
