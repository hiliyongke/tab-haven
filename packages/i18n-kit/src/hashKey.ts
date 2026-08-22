/**
 * 文案哈希 key。
 *
 * 背景：源码里写的是**母语原文**（`t('编辑标签组')`），而词典按 key 组织。
 * 二者需要一个稳定映射，且必须满足：
 *
 *  1. **同一句原文恒等**：`t('编辑标签组')` 在任何文件、任何次调用都得到同一个
 *     key，词典里只需一条译文，多处复用；
 *  2. **对空白不敏感**：原文里多一个空格不代表多一条文案；
 *  3. **运行时与工具链同解**：`t()` 与扫描器必须算出同一个 key，否则扫描出来的
 *     词条运行时永远命中不到（英文模式直接露中文）。
 *
 * 因此哈希算法在这里**单一实现**，CLI 与运行时都 import 本文件——抄一份就一定会
 * 漂移，而漂移的表现是「英文模式整片露中文且查不出原因」。
 */

/** key 前缀：与语义化点号 key（`settings.theme`）区分，避免两类 key 撞车。 */
const KEY_PREFIX = 'i18n_';

/** 36 进制摘要的固定宽度：不足前补 0，超出从低位截断。 */
const KEY_LENGTH = 7;

/**
 * djb2-xor 字符串摘要。
 *
 * 逐字符 `hash * 33 ^ charCode`，末了 `>>> 0` 归一成无符号 32 位整数——
 * 不归一的话 `hash * 33` 会越过 2^31 变成浮点数，`.toString(36)` 出现小数点和
 * 负号，key 里就混进了 `.` 与 `-`，而 `.` 会被 i18next 当 keySeparator 切开。
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
 *
 * 空白先剔除再摘要：`t('编辑 标签组')` 与 `t('编辑标签组')` 是同一条文案，
 * 否则换行/缩进不同的同一句会被算成两条，译文只挂在其中一条上。
 *
 * 上下文（用于区分同一句原文在不同语境下的译法，如「打开」作动词/作状态）
 * 以 `_${context}` 后缀参与，与扫描器写词典时的口径一致。
 *
 * @param sentence 母语原文（源码里 `t()` 的第一个参数）
 * @param context 可选上下文，必须是字符串常量（变量无法被静态扫描）
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
