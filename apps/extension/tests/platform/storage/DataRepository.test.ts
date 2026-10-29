// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { z } from 'zod';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import { clearAllStoredData, DataRepository } from '@/platform/storage/DataRepository';

/**
 * 数据仓库行为规格：校验写入值，隔离不可解析的数据，并为读取与恢复路径提供
 * 可观察的结果。
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

/** 创建用于验证锁内重读行为的仓库。 */
function repoWithLock() {
  return new DataRepository<Array<{ id: string; n: number }>>(KEY, ListSchema, [], {
    rmwLock: 'test.repo-rmw'
  });
}

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
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

  it('默认值按深拷贝给出（调用方原地修改不污染仓库默认值）', async () => {
    // 每次读取默认值都返回独立数据，调用方修改返回值不会改变后续读取结果。
    const r = repo();

    const first = await r.read();
    const second = await r.read();
    first.push({ id: 'leak', n: 1 });

    expect(first).not.toBe(second);
    expect(await r.read()).toEqual([]);
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

    it('恢复后的干净数据回写存储', async () => {
      await fakeBrowser.storage.local.set({
        [KEY]: [
          { id: 'ok', n: 1 },
          { id: 'bad', n: 'x' }
        ]
      });
      const r = repo();
      await r.read();
      // 等待恢复后的数据写入存储。
      await flush();
      const stored = await fakeBrowser.storage.local.get(KEY);
      expect(stored[KEY]).toEqual([{ id: 'ok', n: 1 }]);
    });

    it('被丢弃的坏元素进隔离区并留痕（逐元素恢复不得静默删数据）', async () => {
      await fakeBrowser.storage.local.set({
        [KEY]: [
          { id: 'ok', n: 1 },
          { id: 'bad', n: 'x' },
          { id: 'ok2', n: 2 }
        ]
      });

      const value = await repo().read();

      expect(value).toEqual([
        { id: 'ok', n: 1 },
        { id: 'ok2', n: 2 }
      ]);
      const quarantine = await fakeBrowser.storage.local.get('tabs.quarantine');
      const list = quarantine['tabs.quarantine'] as Array<{ key: string; raw: unknown }>;
      expect(list).toHaveLength(1);
      expect(list[0]!.key).toBe(KEY);
      expect(list[0]!.raw).toEqual([{ id: 'bad', n: 'x' }]);
      expect(readDiagnostics().some((e) => e.message.includes('丢弃 1 条'))).toBe(true);
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

  describe('数组元素级恢复', () => {
    /** 数组元素 schema 的默认值在逐元素恢复时生效。 */
    it('元素级 default 在恢复中生效（证明取到的是 element 而非整表 schema）', async () => {
      const elemKey = 'test.elem.v1';
      const elemSchema = z.object({ id: z.string(), tags: z.array(z.string()).default([]) });
      const r = new DataRepository<Array<{ id: string; tags: string[] }>>(
        elemKey,
        z.array(elemSchema),
        []
      );
      await fakeBrowser.storage.local.set({
        [elemKey]: [{ id: 'a' }, { id: 'b', tags: ['x'] }]
      });

      expect(await r.read()).toEqual([
        { id: 'a', tags: [] },
        { id: 'b', tags: ['x'] }
      ]);
    });
  });

  describe('恢复回写的 RMW 锁（read 语义只读，不得覆盖他页新值）', () => {
    it('恢复期间他页写入的合法新值不被回写覆盖（锁内重读）', async () => {
      const bad = [
        { id: 'ok', n: 1 },
        { id: 'bad', n: 'x' }
      ];
      await fakeBrowser.storage.local.set({ [KEY]: bad });
      const r = repoWithLock();
      const area = fakeBrowser.storage.local as unknown as {
        get: (key: unknown) => Promise<Record<string, unknown>>;
        set: (record: Record<string, unknown>) => Promise<void>;
      };
      const originalGet = area.get;
      const fresh = [{ id: 'new', n: 9 }];
      let gets = 0;
      // 第一次取数是 read() 的快照；第二次起模拟「另一页面已写入合法新值」
      // （真实落盘 + 返回新值，否则断言会因磁盘上根本没有新值而假绿）。
      area.get = vi.fn(async () => {
        gets += 1;
        if (gets === 1) return { [KEY]: bad };
        await area.set({ [KEY]: fresh });
        return { [KEY]: fresh };
      }) as never;

      const value = await r.read();
      area.get = originalGet;

      // 读取结果与存储均保留另一页面写入的新值。
      expect(value).toEqual([{ id: 'new', n: 9 }]);
      const stored = await fakeBrowser.storage.local.get(KEY);
      expect(stored[KEY]).toEqual([{ id: 'new', n: 9 }]);
    });

    it('未配置锁时按读取快照恢复并回写', async () => {
      await fakeBrowser.storage.local.set({
        [KEY]: [
          { id: 'ok', n: 1 },
          { id: 'bad', n: 'x' }
        ]
      });

      expect(await repo().read()).toEqual([{ id: 'ok', n: 1 }]);
      await flush();
      const stored = await fakeBrowser.storage.local.get(KEY);
      expect(stored[KEY]).toEqual([{ id: 'ok', n: 1 }]);
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

  describe('clearAllStoredData', () => {
    /**
     * 安装可重新配置的 localStorage 测试桩。
     */
    function installLocalStorage(): void {
      const store = new Map<string, string>();
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, String(v)),
          removeItem: (k: string) => void store.delete(k)
        }
      });
    }

    it('一并清掉扩展页 localStorage 的主题镜像（PRIVACY.md §3.1-d「随扩展数据一并清除」）', async () => {
      installLocalStorage();
      window.localStorage.setItem('tabs:theme', 'dark');
      window.localStorage.setItem('tabs:theme-hue', 'ocean');
      await fakeBrowser.storage.local.set({ [KEY]: [{ id: 'a', n: 1 }] });

      await clearAllStoredData(async () => undefined);

      expect(window.localStorage.getItem('tabs:theme')).toBeNull();
      expect(window.localStorage.getItem('tabs:theme-hue')).toBeNull();
      expect((await fakeBrowser.storage.local.get(KEY))[KEY]).toBeUndefined();
      Reflect.deleteProperty(window, 'localStorage');
    });

    it('SW 上下文（无 window）跳过 localStorage 清理且不抛错（clearAllStoredData 也从 background 调用）', async () => {
      await fakeBrowser.storage.local.set({ [KEY]: [{ id: 'a', n: 1 }] });
      // Service Worker 没有 window；清理应跳过 localStorage 并完成扩展存储清理。
      vi.stubGlobal('window', undefined);
      try {
        // 确认当前环境没有 window。
        expect(typeof window).toBe('undefined');
        await expect(clearAllStoredData(async () => undefined)).resolves.toBeUndefined();
        expect((await fakeBrowser.storage.local.get(KEY))[KEY]).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
      }
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
