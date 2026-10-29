// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { z } from 'zod';
import { DataRepository } from '@/platform/storage/DataRepository';
import { withCrossPageLock } from '@/platform/storage/crossPageLock';

/**
 * 回归：Web Locks 不可重入，而 store 的标准写法是「锁内重读」——
 * `withCrossPageLock(LOCK, () => repo.read())`。一旦读到的数据坏了，`read` 的恢复分支
 * 会再申请同一把锁，旧实现会**永远排队**：不抛错、不留日志，表现为启动卡死。
 *
 * 这里用不可重入的锁模拟（同名锁已持有时，普通 request 不返回），把「卡死」变成可断言的事实。
 */

const ListSchema = z.array(z.object({ id: z.string(), n: z.number() }));
const KEY = 'test.reentry.v1';

/** 同名锁已持有时，普通 request 永不 resolve；ifAvailable 返回 null。 */
function installNonReentrantLocks(): void {
  const held = new Set<string>();
  vi.stubGlobal('navigator', {
    locks: {
      request: (name: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
        const options = (typeof optionsOrCallback === 'function' ? {} : optionsOrCallback) as {
          ifAvailable?: boolean;
        };
        const callback = (
          typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
        ) as (lock: unknown) => Promise<unknown>;
        if (held.has(name)) {
          if (!options.ifAvailable) return new Promise(() => {});
          return Promise.resolve(callback(null));
        }
        held.add(name);
        return Promise.resolve(callback({ name })).finally(() => held.delete(name));
      }
    }
  });
}

afterEach(() => {
  fakeBrowser.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DataRepository 锁内重读', () => {
  it('锁内读到坏数据不悬挂：跳过回写而不是排队等同一把锁', async () => {
    // Given: 磁盘上是「一条合法 + 一条坏元素」，且锁不可重入
    const raw = [
      { id: 'keep', n: 1 },
      { id: 'bad', n: 'x' }
    ];
    await fakeBrowser.storage.local.set({ [KEY]: raw });
    installNonReentrantLocks();
    const repo = new DataRepository(KEY, ListSchema, [], { rmwLock: 'test.reentry-rmw' });

    // When: 模拟 store 的「持锁 → 重读」
    const reading = withCrossPageLock('test.reentry-rmw', () => repo.read());

    // Then: 必须返回（旧实现在这里永远不 resolve）
    const result = await Promise.race([
      reading,
      new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 200))
    ]);
    expect(result).toEqual([{ id: 'keep', n: 1 }]);

    // 且不回写：拿不到锁时落盘会与持锁方的 read-modify-write 互相覆盖
    expect(await fakeBrowser.storage.local.get(KEY)).toEqual({ [KEY]: raw });
  });
});
