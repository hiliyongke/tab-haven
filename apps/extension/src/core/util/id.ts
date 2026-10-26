/**
 * 全域 id 生成的唯一口径。
 *
 * 各调用点自行 `crypto.randomUUID()` 时，只有部分会写退化路径 —— 其余假设
 * randomUUID 一定存在。扩展页面通常是安全上下文，但非安全上下文 / 旧引擎下
 * `crypto.randomUUID` 可能缺失或直接抛错，各处表现就不一致（有的退化、有的崩）。
 * 统一到本函数：要么都拿到 UUID，要么都走退化，不存在第三种行为。
 */

/** 退化路径的进程内单调递增序号（base36 两位，到顶回绕）。 */
let fallbackSeq = 0;

/** 随机段的取值空间：36^6，保证 base36 后不超过 6 位。 */
const RANDOM_SPAN = 36 ** 6;

/**
 * 退化路径的随机段（固定 6 位 base36）。
 *
 * 优先 CSPRNG：`randomUUID` 缺失不代表 `getRandomValues` 也缺失，
 * 后者可用时熵远高于 `Math.random`。两条分支都取模到同一取值空间，
 * 保证随机段长度恒定（id 形状可解析）。
 */
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
  // 退化路径同样要防碰撞：批量建文件夹 / 快照 / 撤销批次会在**同一毫秒内**
  // 连续取 id，只靠「时间戳 + 随机串」留下真实的碰撞窗口（碰撞的可见后果是
  // 两条记录互相覆盖，表现为「刚建的东西没了」）。因此随机段前带上进程内单调
  // 递增序号 —— 它把同毫秒的碰撞从「概率」变成「不可能」。
  // 序号 2 位 + 随机 6 位 = 8 位，随机段长度恒定（id 形状可解析）。
  fallbackSeq = (fallbackSeq + 1) % 36 ** 2;
  return `${prefix}-${Date.now().toString(36)}-${fallbackSeq.toString(36).padStart(2, '0')}${randomPart()}`;
}
