/**
 * 有限并发映射（纯工具，零宿主依赖）。限流避免 `Promise.all` 一次性发起成百上千条 `chrome.tabs.create` 放大尾延迟。
 * 结果**严格按入参下标返回**（与完成顺序无关）：快照/撤销恢复依赖「组内标签顺序 = 记录顺序」，乱序会让分组归属与排列错乱。
 */

/** 默认并发度：扩展 API 是单个 IPC 通道，8 路左右吞吐最佳，再高只会增大内存峰值与排队抖动。 */
export const DEFAULT_CONCURRENCY = 8;

/** 串行链链尾：吞掉 reject、恒 resolve；每环必须以此收尾，否则漏网 reject 会让后续入队永不 resolve（无报错）。 */
export function chainTail<T>(run: Promise<T>): Promise<void> {
  return run.then(
    () => undefined,
    () => undefined
  );
}

/** 串行链：把「排队 → 执行 → 兜底」三步收口，统一保证链尾**恒被兜底**，单次操作失败不污染后续入队。 */
export interface SerialChain {
  /** 入队并返回操作的原始 Promise（失败会 reject 给调用方），适用「写盘成功才更新内存」等需回执的场景。 */
  enqueue<T>(op: () => Promise<T>): Promise<T>;
  /** 入队并把失败就地留痕、消解为 resolve，适用「void 调用、无人接 rejection」的场景，异常由 `onError` 兜住。 */
  enqueueSettled(op: () => Promise<void>, onError: (error: unknown) => void): Promise<void>;
}

export function createSerialChain(): SerialChain {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(op: () => Promise<T>): Promise<T> {
      const run = tail.then(op);
      tail = chainTail(run);
      return run;
    },
    enqueueSettled(op, onError) {
      const run = tail.then(op);
      const guarded = run.catch((error: unknown) => {
        onError(error);
      });
      tail = guarded;
      return guarded;
    }
  };
}

/** 以不超过 `limit` 的并发度执行全部任务，返回与 `items` 等长同序的结果数组；`task` 抛错时该槽位停止、其余继续，以第一个错误 reject（需容错则在 task 内 try/catch）。 */
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
