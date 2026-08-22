import { browser } from 'wxt/browser';

/**
 * 会话级数据（chrome.storage.session）：面板/浏览器重启即失效。
 * 用于固定条目与真实标签的会话绑定（挂起条目追踪）。
 */

export interface SessionData {
  /** 固定条目 id → 真实标签 id。 */
  itemTabBindings: Record<string, number>;
  /** 手动移出网站聚合的标签 id。 */
  manualStandaloneTabIds: number[];
}

const SESSION_KEY = 'tabhaven.session';

export async function readSession(): Promise<SessionData> {
  try {
    const stored = await browser.storage.session.get(SESSION_KEY);
    const raw = stored[SESSION_KEY] as Partial<SessionData> | undefined;
    return {
      itemTabBindings: raw?.itemTabBindings ?? {},
      manualStandaloneTabIds: Array.isArray(raw?.manualStandaloneTabIds)
        ? raw.manualStandaloneTabIds
        : []
    };
  } catch {
    return { itemTabBindings: {}, manualStandaloneTabIds: [] };
  }
}

export async function writeSession(data: SessionData): Promise<void> {
  try {
    await browser.storage.session.set({ [SESSION_KEY]: data });
  } catch {
    // 会话存储不可用时静默降级为内存态（调用方自行维护）。
  }
}

/** 增量更新会话数据。 */
export async function updateSession(partial: Partial<SessionData>): Promise<void> {
  const current = await readSession();
  await writeSession({ ...current, ...partial });
}
