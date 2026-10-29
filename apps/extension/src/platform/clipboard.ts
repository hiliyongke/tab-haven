import { logDegraded } from '@/platform/diagnostics';

/**
 * 剪贴板写入：唯一出口。`ui/**` 不得直连浏览器 API；失败路径收敛在单处，
 * 否则漏掉 try/catch 的调用点会变成「点了复制，什么也没发生」。
 *
 * 返回布尔而非抛出：调用方只决定成功/失败提示。
 * 失败必须 logDegraded：布尔把异常压成 false，UI 手上没有 error，不落日志则诊断里查不到归因。
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return false;
    await clipboard.writeText(text);
    return true;
  } catch (error) {
    logDegraded('clipboard', '写入剪贴板失败', error);
    return false;
  }
}
