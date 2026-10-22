import { sendMessageWithAck } from '@/platform/messages';
import { logDegraded } from '@/platform/diagnostics';

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
 *  - 应答超时/失败**必须留痕**：整条豁免链要根治的正是「用户显式恢复出来的标签
 *    被复用引擎合并掉」，而发放端失败的表现与它完全同构。此前丢弃返回值，
 *    诊断导出里一片空白 —— 与链条另一端（账本恢复失败已留痕）口径不一致。
 *    返回是否获确认，由调用方决定要不要把它计入 degraded。
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
