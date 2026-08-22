import { describe, expect, it } from 'vitest';
import { createUndoBatch, popBatch, pushBatch, toUndoTabRecord, UNDO_STACK_LIMIT } from '@/core/undo/UndoStack';
import type { TabRecord } from '@/core/tab-types';

function makeTab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

const batch = (label: string) => createUndoBatch('close', [
  { url: `https://${label}.com/`, index: 0, pinned: false, muted: false, groupId: -1 }
]);

/**
 * 行为规格（FR-D8.1）：栈深上限 10、FIFO 淘汰、恢复记录携带五元组。
 */
describe('UndoStack', () => {
  it('入栈保持顺序，弹栈取最新', () => {
    const batches = [batch('a'), batch('b'), batch('c')];
    const [latest, remaining] = popBatch(batches);
    expect(latest?.kind).toBe('close');
    expect(remaining).toHaveLength(2);
  });

  it('超限 FIFO 淘汰（栈深 10）', () => {
    let batches: ReturnType<typeof pushBatch> = [];
    for (let i = 0; i < 12; i += 1) {
      batches = pushBatch(batches, batch(`t${i}`));
    }
    expect(batches).toHaveLength(UNDO_STACK_LIMIT);
    expect(batches[0]?.entries[0]?.url).toBe('https://t2.com/');
    expect(batches.at(-1)?.entries[0]?.url).toBe('https://t11.com/');
  });

  it('撤销记录携带五元组（URL/位置/固定/静音/分组）', () => {
    const tab = makeTab({
      id: 9,
      index: 3,
      url: 'https://a.com/',
      pinned: true,
      muted: true,
      groupId: 5
    });
    const record = toUndoTabRecord(tab, new Map([[5, '调研']]));
    expect(record).toEqual({
      url: 'https://a.com/',
      index: 3,
      pinned: true,
      muted: true,
      groupId: 5,
      groupName: '调研'
    });
  });

  it('未分组标签的组名为空', () => {
    const record = toUndoTabRecord(makeTab({ id: 1, url: 'https://a.com/' }), new Map());
    expect(record.groupName).toBeUndefined();
    expect(record.groupId).toBe(-1);
  });
});
