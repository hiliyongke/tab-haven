import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 浏览器最近关闭桥接：
 * chrome.sessions 读取/恢复浏览器原生记录的最近关闭标签与窗口，
 * 并入撤销历史面板；为崩溃恢复打底。
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
  } catch (error) {
    // 静默降级必须可观测（本模块族纪律）：返回空列表会让撤销历史面板
    // 「最近关闭」分区看起来是空的，实际可能是 sessions API 失败。
    logDegraded('sessions', '读取最近关闭列表失败，本轮按空列表处理', error);
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
  } catch (error) {
    // sessionId 失效（浏览器会话记录滚动淘汰）是预期分支，但其它失败
    // （权限/内部错误）需要留痕，否则「点了恢复没反应」无从排查。
    logDegraded('sessions', '恢复最近关闭条目失败', error);
    return false;
  }
}
