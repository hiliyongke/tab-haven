/**
 * 稳定字符串哈希（纯工具，零宿主依赖）。
 *
 * 「同一输入永远同一输出」是这里的唯一契约，用于从域名 / 组标题派生稳定配色：
 * 只要实现只有一份，两侧派生出的颜色就必然一致。此前 `ui/tabs/accent.ts` 与
 * `core/group/AutoGrouping.ts` 各抄一份逐字符相同的循环，跨 ui/core 两层互不可见，
 * 改一处必然漏另一处 —— 表现为同一站点在强调色与原生组色上不是同一个色。
 */

/**
 * 31 进制滚动哈希（Java String.hashCode 同款）。
 *
 * 31 是奇素数，乘法可被 JIT 优化为 `(h << 5) - h`，且对短字符串（域名、组标题）
 * 的散布优于偶数基数；`| 0` 把结果钉在 32 位有符号整数，避免浮点累积导致的
 * 跨引擎不一致。
 */
export function hash31(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}
