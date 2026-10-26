/**
 * favicon 的定长摘要。
 *
 * favIconUrl 多为 base64 data URL，可占单条数据绝大部分体积；把它整段序列化
 * 会让「每次快照都比较一次签名」持续付大字符串拷贝与转义的代价。
 *
 * 但**不能因此完全忽略它**：忽略等于「仅 favicon 变化永不触发更新」——快照里的
 * 图标会永远停在首次写入的那张（站点换图标、图标在首次快照后才加载完成都会漏）。
 * 折叠成定长摘要后，比较仍能感知变化，而序列化体积恒为几十字节。
 */
function faviconDigest(value: unknown): string {
  if (typeof value !== 'string') return '';
  // djb2：遍历一遍但只留一个 32 位整数，输出定长，不进 JSON 转义的大字符串路径。
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  // 带上长度：两个长度不同的串碰撞概率本就极低，长度参与后摘要唯一性足够。
  return `#${value.length}:${hash}`;
}

/**
 * 变更检测用的结构签名。
 *
 * 用于「读到的持久化值是否真的变了」的判等（避免无意义的整表回写）。
 */
export function structuralSignature(value: unknown): string {
  // `JSON.stringify(undefined)` 返回 **undefined**（不是字符串），返回类型却是
  // `string` —— 类型契约说谎会让「判等」静默变成 `true`，进而跳过本该落盘的写入。
  // 这里保持返回类型 `string`（改签名会波及 5 处调用方），用 String(value) 兜底：
  // 得到的 'undefined' 与任何真实序列化结果都不相等，判等语义仍然成立。
  return (
    JSON.stringify(value, (key, val) => (key === 'favIconUrl' ? faviconDigest(val) : val)) ??
    String(value)
  );
}
