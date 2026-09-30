import { describe, expect, it } from 'vitest';
import { selectRedoTargets } from '@/core/undo/UndoStack';
import type { UndoTabRecord } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';

/**
 * 行为规格（FIX-03 重做）：重做目标 = 当前窗口中 URL 与撤销记录相同的标签。
 *
 * 为什么按 URL 而不是 tabId：撤销记录是「用记录重建标签」，只存五元组，
 * 没有浏览器 tabId（关闭后即失效、恢复出来的也是新 id），因此重做只能按
 * URL 反查 —— 这也决定了固定标签必须豁免，否则重做会关掉用户刚固定的页面。
 */

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

const record = (url: string): UndoTabRecord => ({
  url,
  index: 0,
  pinned: false,
  muted: false,
  groupId: -1
});

describe('selectRedoTargets', () => {
  it('命中窗口中 URL 相同的标签', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://b.com/' })
    ];

    const targets = selectRedoTargets(tabs, [record('https://a.com')]);

    expect(targets.map((tab) => tab.id)).toEqual([1]);
  });

  it('URL 归一化后比较（authority 归一，路径与查询保留）', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://A.com:443/' }),
      makeTab({ id: 2, url: 'https://a.com/x' })
    ];

    // 协议//host:默认端口/ 与 https://a.com 归一后相同 → 命中
    expect(selectRedoTargets(tabs, [record('https://a.com')]).map((t) => t.id)).toEqual([1]);
    // 路径不同的 /x 不应被误关
    expect(selectRedoTargets(tabs, [record('https://a.com/')]).map((t) => t.id)).toEqual([1]);
  });

  it('固定标签豁免（与关闭路径同口径）', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/', pinned: true }),
      makeTab({ id: 2, url: 'https://a.com/', pinned: false })
    ];

    expect(selectRedoTargets(tabs, [record('https://a.com/')]).map((t) => t.id)).toEqual([2]);
  });

  it('无匹配时返回空数组（重做无对象，调用方需明确告知用户）', () => {
    const tabs = [makeTab({ id: 1, url: 'https://other.com/' })];

    expect(selectRedoTargets(tabs, [record('https://a.com/')])).toEqual([]);
  });

  it('记录为空或 URL 为空时返回空数组', () => {
    const tabs = [makeTab({ id: 1, url: 'https://a.com/' })];

    expect(selectRedoTargets(tabs, [])).toEqual([]);
    expect(selectRedoTargets(tabs, [record('')])).toEqual([]);
  });

  it('多条记录可命中多个标签（整批重做）', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://b.com/' }),
      makeTab({ id: 3, url: 'https://c.com/' })
    ];

    const targets = selectRedoTargets(tabs, [record('https://a.com/'), record('https://c.com/')]);

    expect(targets.map((tab) => tab.id)).toEqual([1, 3]);
  });
});
