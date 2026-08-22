// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { mutateSession, readSession, updateSession } from '@/platform/storage/session';

/**
 * session 写操作串行化：read-modify-write 在模块级队列内执行，
 * 并发调用基于「队列内最新值」变换，不互相覆盖。
 */
describe('session 串行化', () => {
  afterEach(() => {
    fakeBrowser.reset();
  });

  it('updateSession 增量合并保留其他字段', async () => {
    await updateSession({ itemTabBindings: { a: 1 } });
    await updateSession({ manualStandaloneTabIds: [42] });

    const session = await readSession();
    expect(session.itemTabBindings).toEqual({ a: 1 });
    expect(session.manualStandaloneTabIds).toEqual([42]);
  });

  it('并发 mutateSession 全部生效（不互相覆盖）', async () => {
    // 并发提交 20 个互不冲突的绑定，任何一次丢失都会导致最终数量不足
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutateSession((s) => ({
          itemTabBindings: { ...s.itemTabBindings, [`key-${i}`]: i }
        }))
      )
    );

    const session = await readSession();
    expect(Object.keys(session.itemTabBindings)).toHaveLength(20);
    expect(session.itemTabBindings['key-19']).toBe(19);
  });

  it('updater 基于队列内最新值变换（后写覆盖先写的同键）', async () => {
    // 同一键并发写不同值：串行化保证最后一个提交者胜出，且不会丢弃整条记录
    const results = await Promise.all([
      mutateSession(() => ({ itemTabBindings: { same: 1 } })),
      mutateSession((s) => ({ itemTabBindings: { ...s.itemTabBindings, same: 2 } }))
    ]);

    const last = results[results.length - 1]!;
    expect(last.itemTabBindings.same).toBe(2);
  });

  it('mutateSession 返回最终合并结果', async () => {
    const result = await mutateSession((s) => ({
      itemTabBindings: { ...s.itemTabBindings, x: 9 }
    }));
    expect(result.itemTabBindings.x).toBe(9);
  });
});
