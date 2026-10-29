/** 面板通用时间格式：M/D HH:mm，供快照与撤销历史共用。 */
export function formatTime(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 日期自适应时间：今天 → HH:mm；今年 → M/D HH:mm；跨年 → Y/M/D。
 *
 * 快照保留上限 30/10 条，跨年完全可能，不带年份会被误判成今年。
 * 「N 分钟前」这类含中文的相对文案由调用方用 `t()` 输出（本模块不持有文案，
 * 否则逃过 i18n 扫描），分钟级判断交给 `minutesSince`。
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const date = new Date(ts);
  const today = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const isSameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isSameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === today.getFullYear()) return formatTime(ts);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** 距现在的分钟数（供调用方决定是否走「N 分钟前」文案）。 */
export function minutesSince(ts: number, now: number = Date.now()): number {
  return Math.floor((now - ts) / 60000);
}
