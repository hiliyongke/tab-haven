import { browser } from 'wxt/browser';
import { z } from 'zod';
import { UndoTabRecordSchema } from '@/core/schema/models';
import { PENDING_ACTIONS_KEY } from '@/platform/storage/keys';
import { PENDING_ACTIONS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { logDegraded } from '@/platform/log';

/**
 * 类型安全消息协议（background ↔ UI）。
 * chrome.runtime 消息层无可信第三方抽象，这里用 zod 定义**唯一的**协议入口 MessageSchema
 * （discriminatedUnion），收发两端共用它解析。消息要经过 runtime 边界，任何一端漏改都只表现为
 * 「消息被静默丢弃」而不报错；把所有类型登记进一个 discriminatedUnion 后，新增消息类型只需改这一处，
 * 两端 switch 未覆盖的分支由 tests/platform/messages.test.ts 的协议契约测试兜住。
 */

/**
 * 消息里的字符串一律设长度上限：这些值会被当作键持久化（url 进豁免账本并镜像到 storage.session）
 * 或送进搜索管线；一旦将来开放 externally_connectable，无上限字符串就是最直接的内存/存储放大面。
 * 上限取远超真实 URL 的值，只拦异常：2048 会误伤超长合法 URL（长分享链接、带大 state 的 OAuth 回跳）
 * 导致其豁免消息校验失败被静默丢弃，故取 8192，仍远小于存储放大面。
 */
const MESSAGE_URL_MAX = 8192;
const MESSAGE_QUERY_MAX = 512;

/* 以下逐类型的 schema 只在**本文件内**被 MessageSchema / PendingActionSchema 聚合使用，故不对外导出：
 * 协议的公开入口只有 MessageSchema、PendingActionSchema 与 Message / PendingAction 两个类型。 */
/** UI → SW：为下一次同 URL 创建申请复用豁免（显式复制/撤销恢复场景）。 */
const AllowDuplicateOnceMessageSchema = z.object({
  type: z.literal('allow-duplicate-once'),
  windowId: z.number().int(),
  url: z.string().max(MESSAGE_URL_MAX)
});

/** SW → UI：发生了一次重复标签复用（通知 UI 显示状态提示）。 */
const DuplicateReusedMessageSchema = z.object({
  type: z.literal('duplicate-reused')
});

/** 复用引擎一次结算能关闭的标签数上限：消息体携带标签快照，必须有界，否则 runtime 通道被当成无上限传输面。 */
export const REUSE_CLOSED_LIMIT = 50;

/**
 * SW → UI：复用引擎（同网址唯一化）本次结算关闭掉的标签快照。
 * 这条消息是「默认开启的自动合并必须可撤销」的回执通道：复用引擎在 SW 内直接 tabs.remove，
 * UI 若不拿到快照就无从登记撤销批次 —— 那是一条不可逆关闭路径。关闭前由 SW 侧构造 UndoTabRecord
 * （带组名，供按名重建原组），UI 侧只负责入撤销栈。
 */
const ReuseClosedMessageSchema = z.object({
  type: z.literal('reuse-closed'),
  /** 关闭发生的窗口（撤销要回到同一个窗口）。 */
  windowId: z.number().int(),
  /** 本次被关闭的标签快照（含新建的那个副本）。 */
  tabs: z.array(UndoTabRecordSchema).max(REUSE_CLOSED_LIMIT)
});

/** SW → UI：请求聚焦搜索（浏览器级快捷键触发）。 */
const SearchFocusMessageSchema = z.object({
  type: z.literal('focus-search'),
  /** 双通道投递使用的独立动作标识。 */
  actionId: z.string().min(1).max(64).optional(),
  /** 触发时间，仅作时间信息，不作为动作唯一键。 */
  at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
});

/** SW → UI：请求按关键词搜索（右键菜单「搜索此域名」触发，面板未开时先开面板）。 */
const SearchDomainMessageSchema = z.object({
  type: z.literal('search-domain'),
  query: z.string().max(MESSAGE_QUERY_MAX),
  /** 双通道投递使用的独立动作标识。 */
  actionId: z.string().min(1).max(64).optional(),
  /** 触发时间，仅作时间信息，不作为动作唯一键。 */
  at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
});

/**
 * 自动休眠回执携带的标签 id 数上限（与 REUSE_CLOSED_LIMIT 同量级）。
 * runtime 通道是无界传输面，整批 id 超限会让消息被 schema 拒绝并静默丢弃 —— 那一轮的「一键唤醒」
 * 入口就此消失，而标签确实已被休眠。发送侧按此上限截断并留痕。
 */
export const AUTO_DISCARDED_IDS_LIMIT = 50;

/** SW → UI：自动休眠执行完成（通知 UI 显示可撤销提示）。 */
const AutoDiscardedMessageSchema = z.object({
  type: z.literal('auto-discarded'),
  tabIds: z.array(z.number().int()).max(AUTO_DISCARDED_IDS_LIMIT),
  /** 此次自动休眠的标签数（可能大于 tabIds 的长度：超限时 tabIds 被截断）。 */
  count: z.number().int(),
  at: z.number()
});

/** SW → UI：请求定位当前激活标签（浏览器级快捷键触发）。 */
const LocateActiveMessageSchema = z.object({
  type: z.literal('locate-active'),
  /** 双通道投递使用的独立动作标识。 */
  actionId: z.string().min(1).max(64).optional(),
  /** 触发时间，仅作时间信息，不作为动作唯一键。 */
  at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
});

/** UI → SW：下一次该窗口关闭时跳过关窗自动快照（归档流程已自行保存，防重复保存）。 */
const SkipAutoSaveOnceMessageSchema = z.object({
  type: z.literal('skip-auto-save-once'),
  windowId: z.number().int()
});

/** SW → UI 待面板执行动作的挂起队列（面板未开时存储于 storage.session）。 */
export { PENDING_ACTIONS_KEY };

/** 设置已落盘的通知（storage.onChanged 之外的显式同步兜底通道）。 */
const SettingsSyncedMessageSchema = z.object({
  type: z.literal('settings-synced')
});

/** 全部消息类型的联合入口：新增消息类型在此登记一份 schema，并到 background.ts（SW 侧）与 sidepanel/App.tsx（UI 侧）各自的 switch 补分支。 */
export const MessageSchema = z.discriminatedUnion('type', [
  AllowDuplicateOnceMessageSchema,
  DuplicateReusedMessageSchema,
  ReuseClosedMessageSchema,
  SearchFocusMessageSchema,
  SearchDomainMessageSchema,
  AutoDiscardedMessageSchema,
  LocateActiveMessageSchema,
  SkipAutoSaveOnceMessageSchema,
  SettingsSyncedMessageSchema
]);
export type Message = z.infer<typeof MessageSchema>;

/** 挂起动作（面板未开时存于 storage.session，面板挂载后补消费）：与 MessageSchema 共享同一批 schema，另抄一份会与协议失去关联。 */
export const PendingActionSchema = z.discriminatedUnion('type', [
  SearchFocusMessageSchema,
  SearchDomainMessageSchema,
  LocateActiveMessageSchema
]);
export type PendingAction = z.infer<typeof PendingActionSchema>;

/** 挂起队列上限（超出丢弃最旧的，避免 session 存储无界增长）。 */
export const PENDING_ACTIONS_LIMIT = 5;
export const PendingActionsSchema = z.array(PendingActionSchema).max(PENDING_ACTIONS_LIMIT);

/**
 * 广播一条协议内消息（fire-and-forget）。
 * 面板未打开时无人接收属**正常场景**（动作已落 session 挂起队列，面板挂载时补消费），
 * 故吞掉 rejection 不进诊断日志 —— 否则每次快捷键都会产生一条假故障。
 */
export function sendMessage(message: Message): void {
  void browser.runtime.sendMessage(message).catch(() => {});
}

/** ack 等待上限：SW 收到消息但不响应时（挂起/卡死）sendMessage 永不 settle，必须超时截断。 */
const ACK_TIMEOUT_MS = 5000;

/**
 * 发送一条需要 SW 应答的消息，返回是否被确认处理。
 * 仅在「消息效果必须先于后续动作发生」时使用 —— 如复用豁免发放必须先于 tabs.create，否则 SW 休眠唤醒
 * 慢于事件派发时 onCreated 先于豁免入账，显式打开的标签会被误合并。SW 不可达时返回 false（调用方按降级处理）。
 * 超时保护：SW 收到消息但从不应答时 Promise 永不 settle，串行 await 的调用链会被整体挂起，故超时按「未确认」降级。
 */
export async function sendMessageWithAck(message: Message): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response: unknown = await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), ACK_TIMEOUT_MS);
      })
    ]);
    return (response as { ok?: boolean } | undefined)?.ok === true;
  } catch {
    return false;
  } finally {
    // 清理超时定时器：批量调用（如快照恢复）时每条消息都会留下一个最长 ACK_TIMEOUT_MS 的悬挂定时器。
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 注册消息监听，返回注销函数：未经协议校验的消息直接丢弃，handler 只会收到合法消息。 */
export function onRuntimeMessage(handler: (message: Message) => void): () => void {
  // sender 可能为 undefined：任何单参数调用（测试桩 / polyfill）都会在读取 sender.id 时抛 TypeError，
  // 而异常发生在监听器里会直接吞掉整条消息通道。
  const listener = (raw: unknown, sender?: { id?: string }): void => {
    // 来源校验：当前未开放 externally_connectable，网页无法投递消息；一旦开放，缺少这道校验就等于
    // 把「申请复用豁免」「跳过自动保存」这类副作用接口暴露给任意页面。
    if (sender?.id !== undefined && sender.id !== browser.runtime.id) return;
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return;
    handler(parsed.data);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

/**
 * 消费「面板未打开期间挂起的动作」，并监听后续写入；返回注销函数。
 * 挂起队列是消息协议的一部分：面板没开时 runtime 消息无人接收，动作落进 session，面板挂载后补齐消费。
 * 读写 storage.session 与监听 onChanged 都收敛到此处，chrome.storage 的触碰面就只剩这一层。
 */
export function watchPendingActions(handler: (action: PendingAction) => void): () => void {
  const sessionArea = browser.storage?.session;
  let active = true;
  // 已消费动作 id 去重集（有界）；没有 id 的协议输入才回退使用安全整数时间戳。
  const consumedIds = new Set<string>();
  const consumedAts = new Set<number>();
  /**
   * 初始读取与 onChanged 都只负责触发；真正消费时在同一把跨页锁内重读并删除。
   * 后台入队使用同一把锁，因此不会用事件里的旧 list 删掉随后入队的新动作。
   */
  const consume = (): void => {
    if (!sessionArea) return;
    void withCrossPageLock(PENDING_ACTIONS_RMW_LOCK, async () => {
      if (!active) return;
      const record = await sessionArea.get(PENDING_ACTIONS_KEY);
      const list = record[PENDING_ACTIONS_KEY];
      if (!active || !Array.isArray(list) || list.length === 0) return;
      for (const action of list) {
        // 队列里的每一项都可能是任意形状，统一走挂起动作 schema 校验。
        const parsed = PendingActionSchema.safeParse(action);
        if (!parsed.success) continue;
        const actionId = parsed.data.actionId;
        const at = parsed.data.at;
        if (actionId !== undefined) {
          if (consumedIds.has(actionId)) continue;
          consumedIds.add(actionId);
          if (consumedIds.size > 64) {
            const oldest = consumedIds.values().next().value;
            if (oldest !== undefined) consumedIds.delete(oldest);
          }
        } else if (at !== undefined) {
          if (consumedAts.has(at)) continue;
          consumedAts.add(at);
          if (consumedAts.size > 64) {
            const oldest = consumedAts.values().next().value;
            if (oldest !== undefined) consumedAts.delete(oldest);
          }
        }
        if (!active) return;
        handler(parsed.data);
      }
      await sessionArea.remove(PENDING_ACTIONS_KEY);
    }).catch((error) => {
      logDegraded('messages', '挂起动作消费失败，将保留队列等待下次触发', error);
    });
  };

  consume();

  const onStorageChanged = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string
  ): void => {
    if (areaName !== 'session' || !changes[PENDING_ACTIONS_KEY]) return;
    const list = changes[PENDING_ACTIONS_KEY]?.newValue;
    // 即时消息与 session 变更通道按 actionId 去重，再消费并清除队列。
    if (Array.isArray(list) && list.length > 0) consume();
  };
  browser.storage?.onChanged?.addListener(onStorageChanged);
  return () => {
    active = false;
    browser.storage?.onChanged?.removeListener(onStorageChanged);
  };
}
