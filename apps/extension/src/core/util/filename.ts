/** 导出文件名生成：纯字符串派生（无 chrome / DOM / React 依赖），故归 core 而非 platform。 */

/** 带当天日期的 JSON 文件名（如 `tabs-backup-2026-09-30.json`）：取本地日期而非 UTC，避免与用户的「今天」差一天导致同名覆盖。 */
export function datedJsonFilename(prefix: string, now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${prefix}-${year}-${month}-${day}.json`;
}
