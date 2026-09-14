/**
 * 全域 id 生成的唯一口径。
 *
 * 此前 `crypto.randomUUID()` 散落在 5 处（core 三处 + undo 一处 + 快照一处），
 * 其中只有快照那处写了退化路径 —— 其余四处假设 randomUUID 一定存在。
 * 扩展页面通常是安全上下文，但非安全上下文 / 旧引擎下 `crypto.randomUUID`
 * 可能缺失或直接抛错，各处表现就不一致了（有的退化、有的崩）。
 * 统一到本函数：要么都拿到 UUID，要么都走退化，不存在第三种行为。
 */
export function newId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // 非安全上下文 / 引擎不提供：走下方退化路径
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
