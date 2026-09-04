import { browser } from 'wxt/browser';
import { z } from 'zod';

/**
 * 类型安全消息协议（background ↔ UI）。
 *
 * chrome.runtime 消息层无可信第三方抽象，这里用 zod 定义**唯一的**协议入口
 * `MessageSchema`（discriminatedUnion），收发两端共用它解析。
 *
 * 为什么必须是联合类型：消息要经过 runtime 边界，任何一端漏改都只表现为
 * 「消息被静默丢弃」而不报错。把所有类型登记进一个 discriminatedUnion 后，
 * 新增消息类型只需改这一处，两端 switch 未覆盖的分支由
 * `tests/platform/messages.test.ts` 的协议契约测试兜住。
 */

/** UI → SW：为下一次同 URL 创建申请复用豁免（显式复制/撤销恢复场景）。 */
export const AllowDuplicateOnceMessageSchema = z.object({
  type: z.literal('allow-duplicate-once'),
  windowId: z.number().int(),
  url: z.string()
});

/** SW → UI：发生了一次重复标签复用（通知 UI 显示状态提示）。 */
export const DuplicateReusedMessageSchema = z.object({
  type: z.literal('duplicate-reused')
});

/** SW → UI：请求聚焦搜索（浏览器级快捷键触发）。 */
export const SearchFocusMessageSchema = z.object({
  type: z.literal('focus-search'),
  /** 触发时间戳：面板双通道（即时消息 + session 挂起）去重用。 */
  at: z.number().optional()
});

/** SW → UI：请求按关键词搜索（右键菜单「搜索此域名」触发，面板未开时先开面板）。 */
export const SearchDomainMessageSchema = z.object({
  type: z.literal('search-domain'),
  query: z.string(),
  /** 触发时间戳：面板双通道（即时消息 + session 挂起）去重用。 */
  at: z.number().optional()
});

/** SW → UI：自动休眠执行完成（通知 UI 显示可撤销提示）。 */
export const AutoDiscardedMessageSchema = z.object({
  type: z.literal('auto-discarded'),
  tabIds: z.array(z.number().int()),
  count: z.number().int(),
  at: z.number()
});

/** SW → UI：请求定位当前激活标签（浏览器级快捷键触发）。 */
export const LocateActiveMessageSchema = z.object({
  type: z.literal('locate-active'),
  /** 触发时间戳：面板双通道（即时消息 + session 挂起）去重用。 */
  at: z.number().optional()
});

/** UI → SW：下一次该窗口关闭时跳过关窗自动快照（归档流程已自行留档，防重复保存）。 */
export const SkipAutoSaveOnceMessageSchema = z.object({
  type: z.literal('skip-auto-save-once'),
  windowId: z.number().int()
});

/** SW → UI 待面板执行动作的挂起队列（面板未开时存储于 storage.session）。 */
export const PENDING_ACTIONS_KEY = 'tabs.pending-actions';

/** 设置已落盘的通知（storage.onChanged 之外的显式同步兜底通道）。 */
export const SettingsSyncedMessageSchema = z.object({
  type: z.literal('settings-synced')
});

/**
 * 全部消息类型的联合入口。
 *
 * 新增消息类型：在此处登记一份 schema，并到 `background.ts`（SW 侧处理）
 * 与 `sidepanel/App.tsx`（UI 侧处理）各自的 switch 中补分支。
 */
export const MessageSchema = z.discriminatedUnion('type', [
  AllowDuplicateOnceMessageSchema,
  DuplicateReusedMessageSchema,
  SearchFocusMessageSchema,
  SearchDomainMessageSchema,
  AutoDiscardedMessageSchema,
  LocateActiveMessageSchema,
  SkipAutoSaveOnceMessageSchema,
  SettingsSyncedMessageSchema
]);
export type Message = z.infer<typeof MessageSchema>;

/**
 * 挂起动作（面板未开时存于 storage.session，面板挂载后补消费）。
 *
 * 与 `MessageSchema` 共享同一批 schema：此前 shared.ts 手抄了一份
 * `PendingActionMessage` 结构类型，与协议 schema 无任何关联，改协议时极易漏改。
 */
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
 *
 * 面板未打开时无人接收属**正常场景**（动作已落 session 挂起队列，面板挂载时补消费），
 * 因此吞掉 rejection 而不进诊断日志——否则每次快捷键都会产生一条假故障。
 */
export function sendMessage(message: Message): void {
  void browser.runtime.sendMessage(message).catch(() => {});
}

/**
 * 注册消息监听，返回注销函数。
 *
 * 未经协议校验的消息直接丢弃，handler 只会收到合法消息。
 */
export function onRuntimeMessage(handler: (message: Message) => void): () => void {
  const listener = (raw: unknown): void => {
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return;
    handler(parsed.data);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
