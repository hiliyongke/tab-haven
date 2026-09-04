import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

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

const SESSION_KEY = 'tabs.session';

const EMPTY_SESSION: SessionData = { itemTabBindings: {}, manualStandaloneTabIds: [] };

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
  } catch (error) {
    // 读取失败会让调用方以为「当前没有任何绑定」，进而错误地重建绑定。
    // 必须可观测（无遥测产品无服务端日志可查），故收口到统一诊断。
    logDegraded('session', '会话数据读取失败，按空会话处理', error);
    return { ...EMPTY_SESSION, itemTabBindings: {}, manualStandaloneTabIds: [] };
  }
}

/**
 * 写入会话数据，返回是否真实落盘。
 *
 * 落盘失败（配额超限 / 存储被策略禁用）时数据仅存在于调用方内存，
 * 面板重启即丢失。返回 false 让调用方有能力向用户提示，而不是静默丢数据。
 */
async function writeSession(data: SessionData): Promise<boolean> {
  try {
    await browser.storage.session.set({ [SESSION_KEY]: data });
    return true;
  } catch (error) {
    logDegraded('session', '会话数据写入失败，已降级为内存态（面板重启后丢失）', error);
    return false;
  }
}

/** 会话写操作串行队列（模块级，进程内全局唯一）。 */
let chain: Promise<void> = Promise.resolve();

/**
 * 会话变更结果：数据 + 持久化是否成功。
 *
 * `persisted === false` 表示本次变更未能落盘，调用方可据此提示用户。
 * 无变更（空 partial）时跳过写盘，此时 `persisted` 反映**上一次**写入的结果，
 * 语义为「当前内存中的值是否已安全持久化」。
 */
export interface MutateSessionResult {
  data: SessionData;
  /** false = 存储不可用，当前值仅存在于内存。 */
  persisted: boolean;
}

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
): Promise<MutateSessionResult> {
  // 显式初始化为「已持久化 + 空数据」：仅在确实发生写入且失败时才置为 false，
  // 避免用非空断言（let result!）掩盖「队列尚未执行」这一状态。
  let result: MutateSessionResult = { data: { ...EMPTY_SESSION }, persisted: true };

  chain = chain.then(async () => {
    const current = await readSession();
    const partial = updater(current);
    const next: SessionData = { ...current, ...partial };

    // updater 无变更（空 partial）时跳过写盘，消除高频路径（如 reconcileWithTabs）的写放大。
    // 此时沿用队列内上一次写入的持久化结果。
    if (Object.keys(partial).length === 0) {
      result = { data: next, persisted: result.persisted };
      return;
    }

    const persisted = await writeSession(next);
    result = { data: next, persisted };
  });

  return chain.then(() => result);
}

/** 增量更新会话数据（队列内 read-modify-write，串行化防竞态）。 */
export function updateSession(partial: Partial<SessionData>): Promise<boolean> {
  return mutateSession((current) => ({ ...current, ...partial })).then((r) => r.persisted);
}
