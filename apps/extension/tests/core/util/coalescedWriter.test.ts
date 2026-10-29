import { describe, expect, it } from 'vitest';
import { createCoalescedWriter } from '@/core/util/coalescedWriter';

/**
 * 行为规格：合并写入器（`core/util/coalescedWriter.ts`）。
 *
 * 它守的是「拖拽重排不放大全量写」：一次拖拽会产生几十次 store 写入，
 * 合并器必须把它们压成「首值 + 末值」两次落盘。写错的表现是**丢最后一次改动**
 * 或**中间值覆盖末值**，而这两类都不会抛错 —— 只能靠时序断言钉住。
 */

/** 手动控制 resolve 时机的闸门，用来制造「写入在途」窗口。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createCoalescedWriter', () => {
  it('单次写入直接落盘，返回值原样透传', async () => {
    const writer = createCoalescedWriter<number, string>({
      write: async (value) => `saved:${value}`
    });
    await expect(writer(1)).resolves.toBe('saved:1');
  });

  it('在途期间的连续写入合并为「首值 + 末值」两次落盘，中间值被丢弃', async () => {
    const writes: number[] = [];
    const gate = deferred<void>();
    const writer = createCoalescedWriter<number, boolean>({
      write: async (value) => {
        writes.push(value);
        if (writes.length === 1) await gate.promise;
        return true;
      }
    });

    const first = writer(1);
    const second = writer(2);
    const third = writer(3);
    gate.resolve();

    await Promise.all([first, second, third]);
    // 2 从未落盘：合并窗口内只有末值有意义。
    expect(writes).toEqual([1, 3]);
  });

  it('并发调用共享同一个在途 Promise（不会各自排一批）', async () => {
    const gate = deferred<void>();
    const writer = createCoalescedWriter<number, boolean>({
      write: async () => {
        await gate.promise;
        return true;
      }
    });

    const first = writer(1);
    const second = writer(2);
    expect(second).toBe(first);

    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('写入失败会 reject 给调用方，且下一次写入仍能继续（在途态已清空）', async () => {
    let attempt = 0;
    const writer = createCoalescedWriter<number, boolean>({
      write: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('disk full');
        return true;
      }
    });

    await expect(writer(1)).rejects.toThrow('disk full');
    await expect(writer(2)).resolves.toBe(true);
  });

  it('cancel 丢弃已排队但未落盘的值，并等在途批次结束', async () => {
    const writes: number[] = [];
    const gate = deferred<void>();
    const writer = createCoalescedWriter<number, boolean>({
      write: async (value) => {
        writes.push(value);
        if (writes.length === 1) await gate.promise;
        return true;
      }
    });

    const first = writer(1);
    const queued = writer(2);
    const cancelled = writer.cancel();
    gate.resolve();

    await cancelled;
    await Promise.all([first, queued]);
    // cancel 之后队列为空：2 不会被补写。
    expect(writes).toEqual([1]);
  });

  it('cancel 不吞掉在途失败以外的语义：写入 reject 时 cancel 自身不抛', async () => {
    const gate = deferred<void>();
    const writer = createCoalescedWriter<number, boolean>({
      write: async () => {
        await gate.promise;
        throw new Error('write failed');
      }
    });

    const pending = writer(1);
    const cancelled = writer.cancel();
    gate.resolve();

    await expect(cancelled).resolves.toBeUndefined();
    await expect(pending).rejects.toThrow('write failed');
  });
});
