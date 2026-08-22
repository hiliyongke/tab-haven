/**
 * 变更检测用的结构签名。
 *
 * 忽略 favIconUrl（多为 base64 data URL，可占单条数据绝大部分体积），
 * 以降低大标签量下每次快照比较的序列化开销。代价是仅 favicon 变化时会延迟一次刷新。
 */
export function structuralSignature(value: unknown): string {
  return JSON.stringify(value, (key, val) => (key === 'favIconUrl' ? undefined : val));
}
