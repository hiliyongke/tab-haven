import { sendMessage } from '@/platform/messages';

/**
 * 向 background 申请一次复用豁免（显式保留副本语义）。
 *
 * 适用场景：显式复制标签 / 撤销恢复 / 快照恢复等「用户明确要求新开」的管线。
 * 必须先发放豁免再创建/导航标签，否则 uniqueUrlTabs 开启时新标签会被复用引擎合并关闭。
 *
 * 可靠性：豁免令牌经 background 镜像到 chrome.storage.session（persistedLedger），
 * SW 在「发放与消费之间」被回收也不会丢失授权；发送失败静默
 * （background 极端不可达时豁免失效，最坏退化为被合并，与历史行为一致）。
 */
export function grantReuseAllowance(windowId: number, url: string): void {
  sendMessage({ type: 'allow-duplicate-once', windowId, url });
}
