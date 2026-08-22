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
export type AllowDuplicateOnceMessage = z.infer<typeof AllowDuplicateOnceMessageSchema>;

/** SW → UI：发生了一次重复标签复用（通知 UI 显示状态提示）。 */
export const DuplicateReusedMessageSchema = z.object({
  type: z.literal('duplicate-reused')
});
export type DuplicateReusedMessage = z.infer<typeof DuplicateReusedMessageSchema>;

/** 全量消息判别联合。 */
export const TabHavenMessageSchema = z.discriminatedUnion('type', [
  AllowDuplicateOnceMessageSchema,
  DuplicateReusedMessageSchema
]);
export type TabHavenMessage = z.infer<typeof TabHavenMessageSchema>;
