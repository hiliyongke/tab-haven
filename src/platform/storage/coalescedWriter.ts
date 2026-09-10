/**
 * 合并写入器：把高频连续写入收敛为「末值落盘」。
 *
 * 通用存储工具，与具体业务无关 —— 原先内联在 `stores/dataStore.ts`，
 * 抽到平台层是因为它操作的是 DataRepository 的 write 通道，属于存储关注点；
 * 放在 store 文件里会让人误以为它依赖 store 状态。
 *
 * 消除拖拽重排等连续操作时的 chrome.storage 全量写入放大。
 * 语义：调用方 await 的 Promise 在「本批最终值已落盘」后 resolve。
 * 注意：DataRepository.write 内部已捕获错误并返回成败标志，此合并器不改变该语义。
 *
 * 附带的 cancel() 用于「清空全部数据」「事务导入」等停止世界操作：
 * 必须先把在途的合并写收尾或丢弃，否则它们会在 clear/import 之后把旧数据回写，
 * 使清空/导入「失效」。
 */
type CoalescedWriter<T, R> = ((value: T) => Promise<R>) & {
  /** 丢弃已排队但未落盘的值，并等待在途批次结束后返回；返回时写入器处于空闲态。 */
  cancel: () => Promise<void>;
};

export function createCoalescedWriter<T, R>(repo: {
  write: (value: T) => Promise<R>;
}): CoalescedWriter<T, R> {
  let inflight: Promise<R> | null = null;
  let queued: T | undefined;
  let hasQueued = false;

  /**
   * 返回本批次最后一次真实落盘的结果：
   * 合并掉的中间值不再单独落盘，因此它们的成败对用户不可见也无意义；
   * 调用方关心的始终是「最终值是否保存成功」，故返回末次 write 的返回值。
   */
  const writer = (value: T): Promise<R> => {
    queued = value;
    hasQueued = true;
    if (inflight) return inflight;
    // inflight 的清空必须在 IIFE 的 finally 内同步完成：
    // 旧写法 `void inflight.finally(...)` 派生新 promise——循环结束到 finally
    // 执行之间存在微任务间隙，间隙内调用 writer 会命中「已结束但未清空」的
    // inflight 直接返回，queued 值再无循环消费（调用方误以为已落盘）；
    // 且派生 promise 的 rejection 无人处理（void 不抑制 unhandled rejection）。
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
    // 丢弃已排队值：在途那次 repo.write 无法中断，但循环不会再取出 queued，
    // 故返回时旧值必不再写入（在途批次的最终落盘值是它开始前的最后一个 target，非最新排队值）。
    hasQueued = false;
    queued = undefined;
    // 契约：cancel 不吞错 —— 注入的 repo.write 若会 reject（当前生产实现不会，
    // DataRepository.write 内部捕获并返回 boolean），此处 catch 兜住，
    // 防止调用方 `await cancel()` 抛错或产生 unhandled rejection。
    return inflight ? inflight.then(() => undefined).catch(() => undefined) : Promise.resolve();
  };

  return writer;
}
