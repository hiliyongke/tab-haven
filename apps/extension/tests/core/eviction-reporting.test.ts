import { describe, expect, it } from 'vitest';
import { pushBatchWithEvicted } from '@/core/undo/UndoStack';

/**
 * core 层「静默淘汰」能把被淘汰项交出去。
 *
 * 纯函数层没有 notify 通道（core 不得依赖 UI/store），因此契约是**返回值**：
 * 精确的淘汰项由调用方负责提示。这里锁死「kept + evicted 无遗漏、无重复」。
 * 快照裁剪同属这一契约但落在 platform 层，见
 * tests/platform/snapshot-eviction-reporting.test.ts（测试目录按层镜像）。
 */

const batch = (id: string) =>
  ({ id, kind: 'close', createdAt: 1, entries: [], windowId: 1 }) as never;

describe('pushBatchWithEvicted', () => {
  it('未超限时无淘汰', () => {
    const r = pushBatchWithEvicted([batch('a')], batch('b'), 10);
    expect(r.evicted).toEqual([]);
    expect(r.kept.map((b: { id: string }) => b.id)).toEqual(['a', 'b']);
  });

  it('超限时淘汰最旧批次', () => {
    const r = pushBatchWithEvicted([batch('a'), batch('b')], batch('c'), 2);
    expect(r.evicted.map((b: { id: string }) => b.id)).toEqual(['a']);
    expect(r.kept.map((b: { id: string }) => b.id)).toEqual(['b', 'c']);
  });

  it('limit 钳到 ≥1：limit=0 时仍保留最新批次', () => {
    const r = pushBatchWithEvicted([], batch('only'), 0);
    expect(r.kept).toHaveLength(1);
  });
});
