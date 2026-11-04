import { describe, expect, it } from 'vitest';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { createUndoBatch } from '@/core/undo/UndoStack';
import type { UndoBatch, UndoTabRecord } from '@/core/schema/models';
import { entriesRemainingAfterClose, pushMergedRedoBatch } from '@/stores/undo/undoActions';

/** 构造一份最小撤销条目。 */
function entry(url: string, index = 0): UndoTabRecord {
  return { url, index, pinned: false, muted: false, groupId: NO_GROUP };
}

/** 构造一份最小标签记录。 */
function tab(id: number, url: string, index = 0): TabRecord {
  return {
    id,
    windowId: 1,
    index,
    active: false,
    pinned: false,
    incognito: false,
    url,
    groupId: NO_GROUP
  };
}

/** 构造带固定 id 与时间戳的撤销批次。 */
function batch(id: string, entries: UndoTabRecord[]): UndoBatch {
  return createUndoBatch('close', entries, { id, now: 1 });
}

describe('entriesRemainingAfterClose', () => {
  it('Given 批次含同网址条目 When 关闭了对应网页标签 Then 按 web 比较键剔除该条目', () => {
    const entries = [entry('https://a.com/x'), entry('https://b.com/')];
    const closed = [tab(1, 'https://a.com/x')];

    expect(entriesRemainingAfterClose(entries, closed)).toEqual([entry('https://b.com/')]);
  });

  it('Given 关闭标签是内部页（无 web 比较键） When 按原始 URL 回退配对 Then 剔除同原始 URL 的条目', () => {
    const entries = [entry('chrome://settings'), entry('https://a.com/')];
    const closed = [tab(2, 'chrome://settings')];

    expect(entriesRemainingAfterClose(entries, closed)).toEqual([entry('https://a.com/')]);
  });

  it('Given 关闭标签在批次里没有匹配项 When 计算剩余条目 Then 全部保留供重试', () => {
    const entries = [entry('https://a.com/')];
    const closed = [tab(9, 'https://other.com/')];

    expect(entriesRemainingAfterClose(entries, closed)).toEqual(entries);
  });

  it('Given 同一网址有多条条目 When 只关闭一个标签 Then 只剔除一条（一对一配对）', () => {
    const entries = [entry('https://a.com/'), entry('https://a.com/')];
    const closed = [tab(1, 'https://a.com/')];

    expect(entriesRemainingAfterClose(entries, closed)).toHaveLength(1);
  });
});

describe('pushMergedRedoBatch', () => {
  it('Given 栈里已有同 id 重做批次 When 再次压入同 id 批次 Then 合并条目且只保留一份', () => {
    const first = batch('same', [entry('https://a.com/')]);
    const second = batch('same', [entry('https://b.com/')]);

    const result = pushMergedRedoBatch([first], second, 10);

    expect(result).toHaveLength(1);
    expect(result[0]!.entries.map((item) => item.url)).toEqual([
      'https://a.com/',
      'https://b.com/'
    ]);
  });

  it('Given 栈里没有同 id 批次 When 压入新批次 Then 原样追加', () => {
    const existing = batch('old', [entry('https://a.com/')]);
    const fresh = batch('new', [entry('https://b.com/')]);

    const result = pushMergedRedoBatch([existing], fresh, 10);

    expect(result.map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('Given 栈深已达上限 When 压入新批次 Then 按 FIFO 淘汰最早批次', () => {
    const a = batch('a', [entry('https://a.com/')]);
    const b = batch('b', [entry('https://b.com/')]);
    const c = batch('c', [entry('https://c.com/')]);

    const result = pushMergedRedoBatch([a, b], c, 2);

    expect(result.map((item) => item.id)).toEqual(['b', 'c']);
  });
});
