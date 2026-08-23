import { browser } from 'wxt/browser';

/**
 * 浏览器最近关闭桥接（E11）：
 * chrome.sessions 读取/恢复浏览器原生记录的最近关闭标签与窗口，
 * 并入撤销历史面板；为崩溃恢复打底（FR-D5.3）。
 */

export interface RecentClosedEntry {
  /** chrome.sessions 的 sessionId（恢复用）。 */
  sessionId: string;
  isWindow: boolean;
  lastModified: number;
  /** 标签条目：标题与 URL。 */
  title?: string;
  url?: string;
  /** 窗口条目：窗口内标签数。 */
  tabCount?: number;
}

/** 读取最近关闭的标签/窗口（最多 20 条）。 */
export async function getRecentlyClosed(): Promise<RecentClosedEntry[]> {
  const sessions = browser.sessions;
  if (!sessions?.getRecentlyClosed) return [];
  try {
    const items = await sessions.getRecentlyClosed({ maxResults: 20 });
    const entries: RecentClosedEntry[] = [];
    for (const item of items) {
      if (item.tab) {
        entries.push({
          sessionId: item.tab.sessionId ?? '',
          isWindow: false,
          lastModified: item.lastModified,
          title: item.tab.title,
          url: item.tab.url
        });
      } else if (item.window) {
        entries.push({
          sessionId: item.window.sessionId ?? '',
          isWindow: true,
          lastModified: item.lastModified,
          tabCount: item.window.tabs?.length ?? 0
        });
      }
    }
    return entries.filter((entry) => entry.sessionId);
  } catch {
    return [];
  }
}

/** 恢复一条最近关闭的标签/窗口（按 sessionId）。 */
export async function restoreRecentClosed(sessionId: string): Promise<boolean> {
  const sessions = browser.sessions;
  if (!sessions?.restore) return false;
  try {
    await sessions.restore(sessionId);
    return true;
  } catch {
    return false;
  }
}
