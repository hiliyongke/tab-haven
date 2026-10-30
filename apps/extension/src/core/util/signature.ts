/** favicon 折叠为定长摘要：base64 data URL 体积大，不能整段序列化；但也不能忽略，否则「仅图标变化」永不触发更新。 */
function faviconDigest(value: unknown): string {
  if (typeof value !== 'string') return '';
  let djb2 = 5381;
  let fnv1a = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    djb2 = ((djb2 << 5) + djb2 + code) | 0;
    fnv1a = Math.imul(fnv1a ^ code, 16777619);
  }
  return `#${value.length}:${(djb2 >>> 0).toString(16)}:${(fnv1a >>> 0).toString(16)}`;
}

/** 结构签名：判等持久化值是否真变了（跳过无意义回写）。 */
export function structuralSignature(value: unknown): string {
  // JSON.stringify(undefined) 返回 undefined 而非 string，会让判等静默变 true。
  // 用 String(value) 兜底：'undefined' 与任何真实序列化结果都不相等。
  return (
    JSON.stringify(value, (key, val) => (key === 'favIconUrl' ? faviconDigest(val) : val)) ??
    String(value)
  );
}
