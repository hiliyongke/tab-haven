/**
 * 变更检测用的结构签名。
 *
 * 语义等价于 `JSON.stringify` 的全量相等比较，但序列化时忽略高体积、不参与渲染
 * 判定的 `favIconUrl`（多为 base64 data URL），把大标签量下每次快照/写入事件的
 * 全量序列化开销降一个量级（favicon 字符串可占单条数据的绝大部分体积）。
 *
 * 取舍：仅 favicon 变化而无其他字段变化时，可能延迟一次刷新（极少见；且下次任意
 * 其他字段变更仍会触发同步）。这是对「内容守卫」性能热路径的定向优化，不改变正确性。
 */
export function structuralSignature(value: unknown): string {
  return JSON.stringify(value, (key, val) => (key === 'favIconUrl' ? undefined : val));
}
