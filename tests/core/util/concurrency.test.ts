import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '@/core/util/concurrency';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('空输入直接返回空数组', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });

  /**
   * 核心契约：快照恢复与撤销恢复都依赖「结果顺序 = 记录顺序」，
   * 组内排列与 tab 落位由该顺序决定，乱序即恢复出错。
   */
  it('结果与入参同序，与完成顺序无关', async () => {
    const delays = [30, 10, 20];
    const out = await mapWithConcurrency(delays, 3, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('并发度不超过限制', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await sleep(1);
        running -= 1;
      }
    );
    expect(peak).toBeGreaterThan(1); // 确实是并发而非串行
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('每项恰好执行一次（含下标透传）', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n, index) => {
      seen.push(index);
      return n;
    });
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('并发度大于任务数时按任务数起 worker', async () => {
    await expect(mapWithConcurrency([1, 2], 100, async (n) => n * 2)).resolves.toEqual([2, 4]);
  });

  /** 非法并发度不得让函数静默不执行（退化为 1 路而非 0 路）。 */
  it('并发度非法时退化为串行而非不执行', async () => {
    await expect(mapWithConcurrency([1, 2, 3], 0, async (n) => n)).resolves.toEqual([1, 2, 3]);
    await expect(mapWithConcurrency([1, 2, 3], -5, async (n) => n)).resolves.toEqual([1, 2, 3]);
  });

  /**
   * 调用方若需要「单条失败不影响其余」，应在 task 内自行 try/catch；
   * 未捕获的错误必须向外传播，不能静默吞掉整批结果。
   */
  it('task 抛错时以该错误 reject', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });

  it('默认并发度为 8', () => {
    expect(DEFAULT_CONCURRENCY).toBe(8);
  });
});
