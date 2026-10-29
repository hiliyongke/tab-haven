/**
 * 合并写入器：把高频连续写入收敛为「末值落盘」，消除拖拽重排等操作的 storage 全量写入放大。
 * 通用工具（入参仅 `{ write }`）；调用方 await 的 Promise 在「本批最终值已落盘」后 resolve，write 错误语义不变。
 * cancel() 用于「清空全部数据」「事务导入」等停止世界操作：先收尾在途合并写，否则旧数据会在其后回写。
 */

/** 只收**值**而不收计算函数：合并窗口内磁盘还没有前一次结果，落盘时再拿磁盘当基线重算会抹掉排队中的改动；本页内存才是权威基线（并发写入由 watcher 回放）。 */
type CoalescedWriter<T, R> = ((value: T) => Promise<R>) & {
  /** 丢弃已排队但未落盘的值，并等待在途批次结束后返回；返回时写入器处于空闲态。 */
  cancel: () => Promise<void>;
};

/** 同一存储键的高频写在途期间合并为「最后一次值」；返回本批次末次真实落盘结果，中间值不单独落盘、其成败无意义。 */
export function createCoalescedWriter<T, R>(repo: {
  write: (value: T) => Promise<R>;
}): CoalescedWriter<T, R> {
  let inflight: Promise<R> | null = null;
  let queued: T | undefined;
  let hasQueued = false;

  const writer = (value: T): Promise<R> => {
    queued = value;
    hasQueued = true;
    if (inflight) return inflight;
    // inflight 必须在 IIFE 的 finally 内同步清空：`void inflight.finally(...)` 派生的新 promise 存在微任务间隙，
    // 间隙内调用 writer 会命中「已结束但未清空」的 inflight，queued 值再无循环消费，且 rejection 无人处理。
    inflight = (async () => {
      try {
        let last!: R;
        while (hasQueued) {
          hasQueued = false;
          const target = queued as T;
          last = await repo.write(target);
        }
        return last;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  writer.cancel = (): Promise<void> => {
    // 在途 repo.write 无法中断，但循环不会再取 queued，故 cancel 返回时旧值必不再写入。
    hasQueued = false;
    queued = undefined;
    // 契约：cancel 不吞错——注入的 repo.write 若 reject（生产实现已捕获），此处 catch 兜住，防止 `await cancel()` 抛错。
    return inflight ? inflight.then(() => undefined).catch(() => undefined) : Promise.resolve();
  };

  return writer;
}
