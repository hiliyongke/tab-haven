import { sendMessageWithAck } from '@/platform/messages';

/**
 * 向 background 申请一次复用豁免（显式保留副本语义）。
 *
 * 适用场景：显式复制标签 / 撤销恢复 / 快照恢复等「用户明确要求新开」的管线。
 * 必须先发放豁免再创建/导航标签，否则 uniqueUrlTabs 开启时新标签会被复用引擎合并关闭。
 *
 * 可靠性：
 *  - 豁免令牌经 background 镜像到 chrome.storage.session（persistedLedger），
 *    SW 在「发放与消费之间」被回收也不会丢失授权；
 *  - 必须 await 应答：fire-and-forget 下 SW 休眠唤醒可能慢于 tabs.create 的事件
 *    派发，onCreated 先于 grantAllowance 执行，令牌 TTL 再长也救不回乱序；
 *  - 应答超时/失败静默（background 极端不可达时豁免失效，最坏退化为被合并，
 *    与历史行为一致）。
 */
export async function grantReuseAllowance(windowId: number, url: string): Promise<void> {
  await sendMessageWithAck({ type: 'allow-duplicate-once', windowId, url });
}
