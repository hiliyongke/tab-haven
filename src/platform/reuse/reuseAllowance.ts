import { browser } from 'wxt/browser';
import { AllowDuplicateOnceMessageSchema } from '@/platform/messages';

/**
 * 向 background 申请一次复用豁免（显式保留副本语义）。
 *
 * 适用场景：显式复制标签 / 撤销恢复 / 快照恢复等「用户明确要求新开」的管线。
 * 必须先发放豁免再创建/导航标签，否则 uniqueUrlTabs 开启时新标签会被复用引擎合并关闭。
 * 发送失败静默（background 未就绪时豁免失效，最坏退化为被合并，与原行为一致）。
 */
export async function grantReuseAllowance(windowId: number, url: string): Promise<void> {
  const message = AllowDuplicateOnceMessageSchema.parse({
    type: 'allow-duplicate-once',
    windowId,
    url
  });
  await browser.runtime.sendMessage(message).catch(() => {});
}
