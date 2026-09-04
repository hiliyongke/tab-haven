// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { z } from 'zod';
import { DataRepository } from '@/platform/storage/DataRepository';

/**
 * 数据仓库：坏数据隔离是「不扩散」承诺的落点。
 *
 * 此前零测试。这里的三条路径一旦退化，用户看到的是「我的收藏夹突然空了」，
 * 而没有任何线索可查——无遥测产品没有服务端日志，隔离区是唯一的现场。
 */

const ItemSchema = z.object({ id: z.string(), n: z.number() });
const ListSchema = z.array(ItemSchema);
const KEY = 'test.repo.v1';

/** storage.onChanged 的派发晚于微任务，需让出一个宏任务才能观察到回调。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function repo(onUnavailable?: () => void) {
  return new DataRepository<Array<{ id: string; n: number }>>(
    KEY,
    ListSchema,
    [],
    onUnavailable ? { onUnavailable } : {}
  );
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('DataRepository', () => {
  it('往返读写：写入后读出同值', async () => {
    const r = repo();
    expect(await r.write([{ id: 'a', n: 1 }])).toBe(true);
    expect(await r.read()).toEqual([{ id: 'a', n: 1 }]);
  });

  it('空存储返回默认值', async () => {
    expect(await repo().read()).toEqual([]);
  });

  it('写入非法值返回 false 且不落盘', async () => {
    const r = repo();
    const ok = await r.write([{ id: 'a', n: 'not-a-number' }] as never);
    expect(ok).toBe(false);
    const stored = await fakeBrowser.storage.local.get(KEY);
    expect(stored[KEY]).toBeUndefined();
  });

  describe('坏数据隔离', () => {
    it('整块校验失败 → 写入隔离区并返回默认值', async () => {
      await fakeBrowser.storage.local.set({ [KEY]: { totally: 'wrong' } });
      const r = repo();

      const value = await r.read();

      expect(value).toEqual([]);
      const quarantine = await fakeBrowser.storage.local.get('tabs.quarantine');
      const list = quarantine['tabs.quarantine'] as Array<{ key: string; raw: unknown }>;
      expect(list).toHaveLength(1);
      expect(list[0]!.key).toBe(KEY);
      expect(list[0]!.raw).toEqual({ totally: 'wrong' });
    });

    it('数组中有坏元素 → 逐元素恢复，干净元素不陪葬', async () => {
      await fakeBrowser.storage.local.set({
        [KEY]: [
          { id: 'ok', n: 1 },
          { id: 'bad', n: 'x' },
          { id: 'ok2', n: 2 }
        ]
      });
      const r = repo();

      const value = await r.read();

      expect(value).toEqual([
        { id: 'ok', n: 1 },
        { id: 'ok2', n: 2 }
      ]);
    });

    it('恢复后的干净数据回写（下次不再走失败分支）', async () => {
      await fakeBrowser.storage.local.set({
        [KEY]: [
          { id: 'ok', n: 1 },
          { id: 'bad', n: 'x' }
        ]
      });
      const r = repo();
      await r.read();
      // 回写是 fire-and-forget，等一个宏任务周期
      await flush();
      const stored = await fakeBrowser.storage.local.get(KEY);
      expect(stored[KEY]).toEqual([{ id: 'ok', n: 1 }]);
    });

    it('隔离区只保留最近 20 条（防止坏数据无限堆积）', async () => {
      await fakeBrowser.storage.local.set({
        'tabs.quarantine': Array.from({ length: 20 }, (_, i) => ({ key: `old-${i}` }))
      });
      await fakeBrowser.storage.local.set({ [KEY]: 'corrupt' });

      await repo().read();

      const quarantine = await fakeBrowser.storage.local.get('tabs.quarantine');
      const list = quarantine['tabs.quarantine'] as Array<{ key: string }>;
      expect(list).toHaveLength(20);
      expect(list[19]!.key).toBe(KEY);
      expect(list[0]!.key).toBe('old-1');
    });
  });

  describe('存储不可用降级', () => {
    it('read 在无 local 区域时回调 onUnavailable 并返回默认值', async () => {
      const onUnavailable = vi.fn();
      const area = fakeBrowser.storage as unknown as { local?: unknown };
      const original = area.local;
      area.local = undefined;

      const value = await repo(onUnavailable).read();

      expect(value).toEqual([]);
      expect(onUnavailable).toHaveBeenCalled();
      area.local = original;
    });

    it('write 在无 local 区域时返回 false 并回调（不静默假装成功）', async () => {
      const onUnavailable = vi.fn();
      const area = fakeBrowser.storage as unknown as { local?: unknown };
      const original = area.local;
      area.local = undefined;

      const ok = await repo(onUnavailable).write([{ id: 'a', n: 1 }]);

      expect(ok).toBe(false);
      expect(onUnavailable).toHaveBeenCalled();
      area.local = original;
    });
  });

  describe('watch', () => {
    it('本 key 变更时回调解析后的值', async () => {
      const r = repo();
      const seen: unknown[] = [];
      const off = r.watch((value) => seen.push(value));

      await fakeBrowser.storage.local.set({ [KEY]: [{ id: 'a', n: 1 }] });
      await flush();

      expect(seen).toEqual([[{ id: 'a', n: 1 }]]);
      off();
    });

    it('忽略其它 key 与其它存储区的变更', async () => {
      const r = repo();
      const onChange = vi.fn();
      const off = r.watch(onChange);

      await fakeBrowser.storage.local.set({ 'other.key': 1 });
      await flush();

      expect(onChange).not.toHaveBeenCalled();
      off();
    });

    // 未覆盖分支（记录以免后人重复踩）：
    // 「键被删除时回调默认值」这一分支依赖 onChanged 携带 `newValue: undefined`，
    // 而 fake-browser 对 `remove` 根本不派发事件、对 `set(undefined)` 则整条丢弃，
    // 两种写法都造不出这个形状。分支本身是防御性的（Chrome 删除键时确为 undefined），
    // 但无法在现有模拟环境下断言，故不写用例。

    it('坏数据不推给订阅者（watch 与 read 同口径）', async () => {
      const r = repo();
      const onChange = vi.fn();
      const off = r.watch(onChange);

      await fakeBrowser.storage.local.set({ [KEY]: 'corrupt' });
      await flush();

      expect(onChange).not.toHaveBeenCalled();
      off();
    });

    it('注销后不再回调', async () => {
      const r = repo();
      const onChange = vi.fn();
      const off = r.watch(onChange);
      off();

      await fakeBrowser.storage.local.set({ [KEY]: [{ id: 'a', n: 1 }] });
      await flush();

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
