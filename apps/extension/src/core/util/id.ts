/**
 * 全域 id 生成的唯一口径：非安全上下文 / 旧引擎下 `crypto.randomUUID` 可能缺失或抛错，
 * 统一到本函数——要么都拿到 UUID，要么都走退化，避免各处表现不一致。
 */

/** 退化路径的进程内单调递增序号（base36 两位，到顶回绕）。 */
let fallbackSeq = 0;

/** 随机段的取值空间：36^6，保证 base36 后不超过 6 位。 */
const RANDOM_SPAN = 36 ** 6;

/** 退化路径的随机段（固定 6 位 base36）：优先 CSPRNG（`getRandomValues` 熵高于 `Math.random`），两分支取模到同一空间保证长度恒定。 */
function randomPart(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return ((buf[0] ?? 0) % RANDOM_SPAN).toString(36).padStart(6, '0');
  }
  return Math.floor(Math.random() * RANDOM_SPAN)
    .toString(36)
    .padStart(6, '0');
}

export function newId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // 非安全上下文 / 引擎不提供：走下方退化路径
  }
  // 批量操作同毫秒连续取 id，仅靠「时间戳 + 随机串」有碰撞窗口，故随机段前加进程内单调序号把同毫秒碰撞变为不可能。
  fallbackSeq = (fallbackSeq + 1) % 36 ** 2;
  return `${prefix}-${Date.now().toString(36)}-${fallbackSeq.toString(36).padStart(2, '0')}${randomPart()}`;
}
