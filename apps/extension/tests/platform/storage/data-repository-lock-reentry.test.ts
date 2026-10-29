// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { z } from 'zod';
import { DataRepository } from '@/platform/storage/DataRepository';
import { withCrossPageLock } from '@/platform/storage/crossPageLock';

/**
 * 锁内读取遇到坏数据时返回符合 schema 的内容；同名锁不可用期间不回写数据。
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
  it('锁内读到坏数据时返回有效内容且不回写', async () => {
    // Given: 磁盘上是「一条合法 + 一条坏元素」，且锁不可重入
    const raw = [
      { id: 'keep', n: 1 },
      { id: 'bad', n: 'x' }
    ];
    await fakeBrowser.storage.local.set({ [KEY]: raw });
    installNonReentrantLocks();
    const repo = new DataRepository(KEY, ListSchema, [], { rmwLock: 'test.reentry-rmw' });

    // When: 在持锁状态下读取数据
    const reading = withCrossPageLock('test.reentry-rmw', () => repo.read());

    // Then: 在限定时间内返回符合 schema 的有效数据
    const result = await Promise.race([
      reading,
      new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 200))
    ]);
    expect(result).toEqual([{ id: 'keep', n: 1 }]);

    // 无法获取锁时不回写存储内容。
    expect(await fakeBrowser.storage.local.get(KEY)).toEqual({ [KEY]: raw });
  });
});
