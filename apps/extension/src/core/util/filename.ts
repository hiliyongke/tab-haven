/**
 * 导出文件名生成。
 *
 * 放在 core 的原因：这是纯字符串派生（无 chrome / DOM / React 依赖），
 * 而 platform/navigation 只应保留真正触碰浏览器 API 的下载动作。
 */

/**
 * 带当天日期的 JSON 文件名（如 `tabs-backup-2026-09-30.json`）。
 *
 * 取**本地日期**而非 UTC：UTC 日期在东八区早上 8 点前、西半球傍晚之后都与用户
 * 看到的「今天」差一天，导出文件命名与用户预期不符（且两份同名文件会互相覆盖）。
 */
export function datedJsonFilename(prefix: string, now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${prefix}-${year}-${month}-${day}.json`;
}
