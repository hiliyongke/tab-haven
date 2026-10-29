/**
 * 文案哈希 key：源码写母语原文（`t('编辑标签组')`），词典按 key 组织，二者靠本文件单一实现映射。
 *
 * 必须单一实现：CLI 与运行时各抄一份必然漂移，表现为「英文模式整片露中文且查不出原因」。
 */

/** 与语义化点号 key（`settings.theme`）区分，避免两类 key 撞车。 */
const KEY_PREFIX = 'i18n_';

/** 36 进制摘要固定宽度：不足前补 0，超出从低位截断。 */
const KEY_LENGTH = 7;

/**
 * djb2-xor 字符串摘要。
 * `>>> 0` 归一成无符号 32 位是必需的：不归一 `hash * 33` 会越过 2^31 变浮点数，
 * `.toString(36)` 带出 `.` 和 `-`，而 `.` 会被 i18next 当 keySeparator 切开。
 */
export function hashString(input: string): number {
  let hash = 5381;
  let index = input.length;
  while (index > 0) {
    hash = (hash * 33) ^ input.charCodeAt(--index);
  }
  return hash >>> 0;
}

/**
 * 由母语原文算出词条 key。
 * 空白先剔除再摘要：否则换行/缩进不同的同一句会被算成两条，译文只挂在其中一条上。
 *
 * @param sentence 母语原文（`t()` 的第一个参数）
 * @param context 可选上下文，必须字符串常量（变量无法被静态扫描）
 */
export function toHashKey(sentence: string, context?: string): string {
  const digest = hashString(sentence.replace(/\s+/g, '')).toString(36);
  const key = `${KEY_PREFIX}${`0000${digest}`.slice(-KEY_LENGTH)}`;
  return context === undefined || context === '' ? key : `${key}_${context}`;
}

/** 是否为哈希 key（与语义化点号 key 区分）。 */
export function isHashKey(key: string): boolean {
  return new RegExp(`^${KEY_PREFIX}[0-9a-z]{${KEY_LENGTH}}(_.+)?$`).test(key);
}
