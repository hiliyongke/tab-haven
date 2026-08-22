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
    expect(last.data.itemTabBindings.same).toBe(2);
  });

  it('mutateSession 返回最终合并结果', async () => {
    const result = await mutateSession((s) => ({
      itemTabBindings: { ...s.itemTabBindings, x: 9 }
    }));
    expect(result.data.itemTabBindings.x).toBe(9);
  });

  it('返回 persisted 标志：正常存储为 true', async () => {
    const result = await mutateSession(() => ({ manualStandaloneTabIds: [1] }));
    expect(result.persisted).toBe(true);
    expect(result.data.manualStandaloneTabIds).toEqual([1]);
  });

  it('返回 persisted=false：写入失败时调用方可感知（不再静默丢数据）', async () => {
    // 模拟存储不可用（配额超限 / 被策略禁用）。保存原方法并在用后恢复，
    // 否则污染会泄漏到后续用例（fakeBrowser 在 afterEach 才 reset）。
    const originalSet = fakeBrowser.storage.session.set;
    fakeBrowser.storage.session.set = (() => Promise.reject(new Error('quota'))) as never;
    try {
      const result = await mutateSession(() => ({ manualStandaloneTabIds: [7] }));

      expect(result.persisted).toBe(false);
      // 内存态仍返回合并结果，UI 不崩；但标志位让调用方能提示用户。
      expect(result.data.manualStandaloneTabIds).toEqual([7]);
    } finally {
      fakeBrowser.storage.session.set = originalSet;
    }
  });

  it('updateSession 透出持久化结果', async () => {
    expect(await updateSession({ manualStandaloneTabIds: [3] })).toBe(true);

    const originalSet = fakeBrowser.storage.session.set;
    fakeBrowser.storage.session.set = (() => Promise.reject(new Error('quota'))) as never;
    try {
      expect(await updateSession({ manualStandaloneTabIds: [4] })).toBe(false);
    } finally {
      fakeBrowser.storage.session.set = originalSet;
    }
  });
});
