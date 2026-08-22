/**
 * 剪贴板写入：唯一出口。
 *
 * 为什么单独一层：
 *  1. **分层红线** —— `ui/**` 不得直连浏览器 API（见 CONTRIBUTING / README 的架构节）；
 *  2. **失败路径必须收敛** —— 剪贴板在非安全上下文、缺少用户手势、权限被拒、
 *     文档未聚焦时都会抛错（且各浏览器抛的时机不一致）。若每个调用点各写一份
 *     try/catch，漏掉的那份就会变成「点了复制，什么也没发生」。
 *
 * 返回布尔而不是抛出：调用方只需决定「成功提示 / 失败提示」两种反馈，
 * 不必各自判断错误类型。
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
