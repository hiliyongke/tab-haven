/**
 * 有限并发映射（纯工具，零宿主依赖）。
 *
 * 与 `Promise.all(items.map(...))` 的区别：`Promise.all` 会一次性发起全部任务，
 * 成百上千条 `chrome.tabs.create` 同时打向浏览器只会放大尾延迟与排队抖动；
 * 限流后吞吐由并发度控制，总量越大收益越明显。
 *
 * 结果**严格按入参下标返回**（与完成顺序无关）：快照恢复、撤销恢复都依赖
 * 「组内标签顺序 = 记录顺序」，乱序会让分组归属与组内排列错乱，因此这里不
 * 提供「先完成先返回」的语义。
 */

/**
 * 默认并发度。
 *
 * 浏览器扩展 API 是单个 IPC 通道，8 路左右吞吐最佳；再往上不会更快，只会让
 * 单次恢复的内存峰值与排队抖动变大。
 */
export const DEFAULT_CONCURRENCY = 8;

/**
 * 以不超过 `limit` 的并发度执行全部任务，返回与 `items` 等长、同序的结果数组。
 *
 * `task` 抛错时：该任务所在槽位的 worker 停止，其余在途任务继续，最终以第一个
 * 错误 reject。调用方若希望「单条失败不影响其余」，应在 `task` 内部自行
 * try/catch（恢复类管线的既定语义）。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  // 取号与自增之间没有 await，单线程下不会被其它 worker 插入。
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index);
    }
  };
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}
