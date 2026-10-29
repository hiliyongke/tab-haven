import { sendMessageWithAck } from '@/platform/messages';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 向 background 申请一次复用豁免（显式保留副本语义）：适用于显式复制标签 / 撤销恢复 / 快照恢复等
 * 「用户明确要求新开」的管线，必须先发放豁免再创建/导航标签，否则 uniqueUrlTabs 开启时新标签会被合并。
 *
 * 令牌经 background 镜像到 storage.session，SW 在「发放与消费之间」被回收也不丢授权。
 * 必须 await 应答：fire-and-forget 下 SW 唤醒可能慢于 tabs.create 的事件派发，onCreated 先于
 * grantAllowance 执行，令牌 TTL 再长也救不回乱序。应答失败必须留痕——与「恢复的标签被合并」表现同构。
 * @returns 是否获确认，由调用方决定是否计入 degraded。
 */
export async function grantReuseAllowance(windowId: number, url: string): Promise<boolean> {
  const granted = await sendMessageWithAck({ type: 'allow-duplicate-once', windowId, url });
  if (!granted) {
    logDegraded(
      'reuse',
      `复用豁免发放未获确认（窗口 ${windowId}），恢复/新建的标签可能被合并`,
      undefined
    );
  }
  return granted;
}
