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
 */
export function createCoalescedWriter<T, R>(repo: { write: (value: T) => Promise<R> }) {
  let inflight: Promise<R> | null = null;
  let queued: T | undefined;
  let hasQueued = false;

  /**
   * 返回本批次最后一次真实落盘的结果：
   * 合并掉的中间值不再单独落盘，因此它们的成败对用户不可见也无意义；
   * 调用方关心的始终是「最终值是否保存成功」，故返回末次 write 的返回值。
   */
  return (value: T): Promise<R> => {
    queued = value;
    hasQueued = true;
    if (inflight) return inflight;
    inflight = (async () => {
      let last!: R;
      while (hasQueued) {
        hasQueued = false;
        const target = queued as T;
        last = await repo.write(target);
      }
      return last;
    })();
    void inflight.finally(() => {
      inflight = null;
    });
    return inflight;
  };
}
