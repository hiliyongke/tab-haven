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

/** 最近关闭的读取条数：sessions 是「刚关错了想找回」的入口，一屏足够。 */
const RECENTLY_CLOSED_LIMIT = 20;

/** 读取最近关闭的标签/窗口（最多 RECENTLY_CLOSED_LIMIT 条）。 */
export async function getRecentlyClosed(): Promise<RecentClosedEntry[]> {
  const sessions = browser.sessions;
  if (!sessions?.getRecentlyClosed) return [];
  try {
    const items = await sessions.getRecentlyClosed({ maxResults: RECENTLY_CLOSED_LIMIT });
    const entries: RecentClosedEntry[] = [];
    let skipped = 0;
    for (const item of items) {
      const tab = item.tab;
      const win = item.window;
      const sessionId = tab?.sessionId ?? win?.sessionId;
      // sessionId 是恢复的唯一钥匙。缺失时**不**用空串补位再造一条条目、然后靠
      // 末尾 filter 把它丢掉 —— 那是「先造坏数据再补救」；直接跳过，并对跳过
      // 条数留痕（全条跳过说明接口返回了非预期结构，值得看见）。
      if (!sessionId) {
        skipped += 1;
        continue;
      }
      if (tab) {
        entries.push({
          sessionId,
          isWindow: false,
          lastModified: item.lastModified,
          title: tab.title,
          url: tab.url
        });
      } else if (win) {
        entries.push({
          sessionId,
          isWindow: true,
          lastModified: item.lastModified,
          tabCount: win.tabs?.length ?? 0
        });
      }
    }
    if (skipped > 0) {
      logDegraded('sessions', `最近关闭列表中有 ${skipped} 条缺少 sessionId，已跳过`);
    }
    return entries;
  } catch (error) {
    // 静默降级必须可观测（本模块族纪律）：返回空列表会让撤销历史面板
    // 「最近关闭」分区看起来是空的，实际可能是 sessions API 失败。
    logDegraded('sessions', '读取最近关闭列表失败，本次按空列表处理', error);
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
