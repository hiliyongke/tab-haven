import { z } from 'zod';

/**
 * 类型安全消息协议（background ↔ UI）。
 *
 * 设计（docs/ARCHITECTURE.md 5.6）：chrome.runtime 消息层无可信第三方抽象，
 * 以 zod schema + 薄封装自实现（约 50 行）。所有消息经 discriminatedUnion
 * 统一解析，杜绝未校验的消息类型。
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
  type: z.literal('focus-search')
});

/** SW → UI：请求按关键词搜索（右键菜单「搜索此域名」触发，面板未开时先开面板）。 */
export const SearchDomainMessageSchema = z.object({
  type: z.literal('search-domain'),
  query: z.string()
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
  type: z.literal('locate-active')
});

/** SW → UI 待面板执行动作的挂起队列（面板未开时存储于 storage.session）。 */
export const PENDING_ACTIONS_KEY = 'tabhaven.pending-actions';

/** 设置已落盘的通知（storage.onChanged 之外的显式同步兜底通道）。 */
export const SettingsSyncedMessageSchema = z.object({
  type: z.literal('settings-synced')
});
