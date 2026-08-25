/** 面板通用时间格式：M/D HH:mm（快照 / 撤销历史共用，替代两处逐字重复实现）。 */
export function formatTime(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
