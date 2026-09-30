/**
 * 导出文件名生成。
 *
 * 放在 core 的原因：这是纯字符串派生（无 chrome / DOM / React 依赖），
 * 而 platform/navigation 只应保留真正触碰浏览器 API 的下载动作。
 */

/** 带当天日期的 JSON 文件名（如 `tabs-backup-2026-09-30.json`）。 */
export function datedJsonFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
}
