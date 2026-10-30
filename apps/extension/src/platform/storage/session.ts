import { browser } from 'wxt/browser';
import { z } from 'zod';
import { SESSION_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { createSerialChain } from '@/core/util/concurrency';
import { SESSION_KEY } from './keys';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 会话级数据（chrome.storage.session）：面板/浏览器重启即失效，用于固定条目与真实标签的会话绑定。
 * 读写都经 zod 校验：storage.session 内容同样可能来自异常写入，裸 `as` 断言会让下游静默错绑非 number 的 tabId。
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

/**
 * 空会话（每次返回新对象）。
 * 不能写成 `{ ...EMPTY_SESSION }`：浅拷贝只换外层，内层 `{}` / `[]` 仍是同一常量引用，
 * 调用方往 itemTabBindings 塞一个键就永久污染了它。
 */
function emptySession(): SessionData {
  return { itemTabBindings: {}, manualStandaloneTabIds: [] };
}

/** 只读用途的空会话常量（需要可写默认值时调用 emptySession()）。 */
const EMPTY_SESSION: SessionData = emptySession();

/** 写失败后的本上下文 dirty 基线：后续读取与 mutation 不得退回旧磁盘值覆盖内存变更。 */
let volatileSession: SessionData | undefined;

function cloneSession(data: SessionData): SessionData {
  return {
    itemTabBindings: { ...data.itemTabBindings },
    manualStandaloneTabIds: [...data.manualStandaloneTabIds]
  };
}

/** 读取会话数据：校验失败按空会话返回并留痕（会话是渲染期派生状态，坏数据丢弃后可重建）。 */
export async function readSession(): Promise<SessionData> {
  if (volatileSession) return cloneSession(volatileSession);
  try {
    const stored = await browser.storage.session.get(SESSION_KEY);
    const parsed = SessionDataSchema.safeParse(stored[SESSION_KEY]);
    if (!parsed.success) {
      // 坏数据不扩散：丢弃并留痕，而不是把非 number 的 tabId 交给下游。
      if (stored[SESSION_KEY] !== undefined) {
        logDegraded('session', '会话数据校验失败，已按空会话处理', parsed.error);
      }
      return emptySession();
    }
    return parsed.data;
  } catch (error) {
    // 读取失败会让调用方以为「当前无绑定」进而错误重建；必须可观测，收口到统一诊断。
    logDegraded('session', '会话数据读取失败，按空会话处理', error);
    return emptySession();
  }
}

/**
 * 写入会话数据，返回是否真实落盘。
 * 落盘失败（配额超限 / 存储被策略禁用）时数据仅存在于内存，面板重启即丢失；
 * 返回 false 让调用方有能力向用户提示，而不是静默丢数据。
 */
async function writeSession(data: SessionData): Promise<boolean> {
  try {
    // 写入侧也过 schema：只校验读侧会让「内存合法、磁盘非法」的数据绕过唯一校验口径。
    await browser.storage.session.set({ [SESSION_KEY]: SessionDataSchema.parse(data) });
    return true;
  } catch (error) {
    logDegraded('session', '会话数据写入失败，已降级为内存态（面板重启后丢失）', error);
    return false;
  }
}

/** 会话写操作串行队列（模块级，进程内全局唯一）。 */
const chain = createSerialChain();

/**
 * 本上下文上一次真实写入的持久化结果（无变更跳过写盘时沿用）。
 * 语义为「当前内存值是否已安全落盘」：上次写失败后一次无变更调用不得报告 persisted: true。
 */
let lastPersisted = true;

/**
 * 会话变更结果：persisted === false 表示本次变更未能落盘，调用方可据此提示用户。
 * 无变更（空 partial）时跳过写盘，此时 persisted 反映上一次写入结果。
 */
export interface MutateSessionResult {
  data: SessionData;
  /** false = 存储不可用，当前值仅存在于内存。 */
  persisted: boolean;
}

/**
 * 基于当前会话数据做变换（页内串行 + 跨页互斥）。
 * 页内所有 RMW 经模块级串行队列；跨页实例（sidepanel / background）由 SESSION_RMW_LOCK 串行化 ——
 * 整个 read → modify → write 都在锁内完成。
 */
export function mutateSession(
  updater: (current: SessionData) => Partial<SessionData>
): Promise<MutateSessionResult> {
  // 显式初始化为「已持久化 + 空数据」：仅在确实写入且失败时才置 false，避免用非空断言掩盖状态。
  let result: MutateSessionResult = { data: { ...EMPTY_SESSION }, persisted: true };

  const step = async (): Promise<void> => {
    try {
      // 跨页锁内完成 read → modify → write：页内串行链只能串行化本上下文，两窗口并发仍会整表互覆。
      await withCrossPageLock(SESSION_RMW_LOCK, async () => {
        const current = await readSession();
        const partial = updater(current);
        const next: SessionData = { ...current, ...partial };

        // updater 无变更（空 partial）时跳过写盘，消除高频路径（如 reconcileWithTabs）写放大，沿用上次持久化结果。
        if (Object.keys(partial).length === 0) {
          result = { data: next, persisted: lastPersisted };
          return;
        }

        const persisted = await writeSession(next);
        // 写失败后保留本上下文的 dirty 基线：下一次 mutation 必须从这份内存值继续，
        // 不能重新读到旧磁盘值而把前一次已返回给调用方的变更静默抹掉。
        volatileSession = persisted ? undefined : cloneSession(next);
        lastPersisted = persisted;
        result = { data: next, persisted };
      });
    } catch (error) {
      // 异常必须就地消化：链上任何一环抛出，chain 都会变成 rejected promise，此后每个 mutateSession
      // 的 .then 回调全被跳过，会话写入永久静默失效。updater 是调用方闭包，不可信任。
      logDegraded('session', '会话数据变更失败，已保留当前内存值', error);
      lastPersisted = false;
      result = { data: result.data, persisted: false };
    }
  };

  // step 自身已 try/catch；链尾再由 SerialChain 兜底，确保队列不会被污染成永久 rejected。
  return chain.enqueue(step).then(() => result);
}

/** 增量更新会话数据（队列内 read-modify-write，串行化防竞态）。 */
export function updateSession(partial: Partial<SessionData>): Promise<boolean> {
  // 直接透传 partial：包装为 {...current, ...partial} 会恒含全部 key，空变更跳过写盘判定永不成立。
  return mutateSession(() => partial).then((r) => r.persisted);
}
