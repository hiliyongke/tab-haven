/** 稳定字符串哈希（纯工具，零宿主依赖）：同一输入永远同一输出，用于从域名 / 组标题派生稳定配色；实现须只有一份，否则两处会对同一站点派生出不同颜色。 */

/** 31 进制滚动哈希（Java String.hashCode 同款）：31 是奇素数、乘法可优化为 `(h << 5) - h`，对短字符串散布优于偶数基数；`| 0` 钉在 32 位有符号整数避免跨引擎不一致。 */
export function hash31(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}
