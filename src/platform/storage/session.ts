import { browser } from 'wxt/browser';

/**
 * 会话级数据（chrome.storage.session）：面板/浏览器重启即失效。
 * 用于固定条目与真实标签的会话绑定（挂起条目追踪）。
 */

interface SessionData {
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

async function writeSession(data: SessionData): Promise<void> {
  try {
    await browser.storage.session.set({ [SESSION_KEY]: data });
  } catch {
    // 会话存储不可用时静默降级为内存态（调用方自行维护）。
  }
}

/** 会话写操作串行队列（模块级，进程内全局唯一）。 */
let chain: Promise<void> = Promise.resolve();

/**
 * 基于当前会话数据做变换（串行化）。
 *
 * 并发安全：所有 read-modify-write 操作经模块级串行队列执行，
 * 每个 updater 都基于队列内最新的存储值计算，避免快速连续操作互相覆盖。
 * 跨页面实例（popup/sidepanel 同时打开）仍有理论竞态窗口，属 MV3 固有约束，
 * 通过单次原子写降低实际影响。
 */
export function mutateSession(
  updater: (current: SessionData) => Partial<SessionData>
): Promise<SessionData> {
  let result!: SessionData;
  chain = chain.then(async () => {
    const current = await readSession();
    const partial = updater(current);
    result = { ...current, ...partial };
    // updater 无变更（空 partial）时跳过写盘，消除高频路径（如 reconcileWithTabs）的写放大。
    if (Object.keys(partial).length === 0) return;
    await writeSession(result);
  });
  return chain.then(() => result);
}

/** 增量更新会话数据（队列内 read-modify-write，串行化防竞态）。 */
export function updateSession(partial: Partial<SessionData>): Promise<void> {
  return mutateSession((current) => ({ ...current, ...partial })).then(() => undefined);
}
