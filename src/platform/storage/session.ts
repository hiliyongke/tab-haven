import { browser } from 'wxt/browser';
import { z } from 'zod';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 会话级数据（chrome.storage.session）：面板/浏览器重启即失效。
 * 用于固定条目与真实标签的会话绑定（挂起条目追踪）。
 *
 * 与其余持久化数据一致，读写都必须经 zod 校验（架构约定）：
 * storage.session 的内容同样可能来自异常写入或旧版本残留，
 * 裸 `as` 断言会让下游拿到非 number 的 tabId 并静默错绑。
 */

/** 单窗口标签规模上限（远超正常使用，只拦异常数据）。 */
const SESSION_TAB_IDS_LIMIT = 2_000;

const SessionDataSchema = z.object({
  /** 固定条目 id → 真实标签 id。 */
  itemTabBindings: z.record(z.string(), z.number().int()).default({}),
  /** 手动移出网站聚合的标签 id。 */
  manualStandaloneTabIds: z.array(z.number().int()).max(SESSION_TAB_IDS_LIMIT).default([])
});

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
    const parsed = SessionDataSchema.safeParse(stored[SESSION_KEY]);
    if (!parsed.success) {
      // 坏数据不扩散：丢弃并留痕，而不是把非 number 的 tabId 交给下游。
      if (stored[SESSION_KEY] !== undefined) {
        logDegraded('session', '会话数据校验失败，已按空会话处理', parsed.error);
      }
      return { ...EMPTY_SESSION, itemTabBindings: {}, manualStandaloneTabIds: [] };
    }
    return parsed.data;
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
 * 本上下文上一次真实写入的持久化结果（无变更跳过写盘时沿用）。
 * 语义为「当前内存值是否已安全落盘」：上次写失败后，一次无变更调用
 * 不得报告 persisted: true。跨上下文无法共享该标志（MV3 固有限定）。
 */
let lastPersisted = true;

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

  const step = async (): Promise<void> => {
    try {
      const current = await readSession();
      const partial = updater(current);
      const next: SessionData = { ...current, ...partial };

      // updater 无变更（空 partial）时跳过写盘，消除高频路径（如 reconcileWithTabs）的写放大。
      // 沿用本上下文上一次真实写入的持久化结果（非本次调用的初始值）。
      if (Object.keys(partial).length === 0) {
        result = { data: next, persisted: lastPersisted };
        return;
      }

      const persisted = await writeSession(next);
      lastPersisted = persisted;
      result = { data: next, persisted };
    } catch (error) {
      // 异常必须就地消化。链上任何一环抛出，chain 都会变成 rejected promise，
      // 此后每个 mutateSession 的 `.then` 回调全部被跳过 —— 会话写入永久静默失效，
      // 而调用方拿到的仍是一个「成功」的 Promise。updater 是调用方闭包，不可信任。
      logDegraded('session', '会话数据变更失败，已保留当前内存值', error);
      lastPersisted = false;
      result = { data: result.data, persisted: false };
    }
  };

  // 双保险：step 自身已 try/catch，第二个参数再兜住上一次遗留的 rejection，
  // 确保队列不会被污染成永久 rejected。
  chain = chain.then(step, step);

  return chain.then(() => result);
}

/** 增量更新会话数据（队列内 read-modify-write，串行化防竞态）。 */
export function updateSession(partial: Partial<SessionData>): Promise<boolean> {
  // 直接透传 partial：此前包装为 `{ ...current, ...partial }` 恒含全部 key，
  // mutateSession 的「空变更跳过写盘」判定永远不成立，每次都全量写盘。
  return mutateSession(() => partial).then((r) => r.persisted);
}
