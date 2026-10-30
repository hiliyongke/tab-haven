import { describe, expect, it } from 'vitest';
import { selectRedoTargets } from '@/core/undo/UndoStack';
import type { UndoTabRecord } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';

/**
 * 重做目标行为规格：按 URL 在当前窗口匹配撤销记录中的标签，并默认排除固定标签。
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

  it('内部页按原始 URL 匹配', () => {
    const tabs = [
      makeTab({ id: 1, url: 'chrome://newtab/' }),
      makeTab({ id: 2, url: 'about:blank' })
    ];

    expect(selectRedoTargets(tabs, [record('chrome://newtab/')]).map((t) => t.id)).toEqual([1]);
    expect(selectRedoTargets(tabs, [record('about:blank')]).map((t) => t.id)).toEqual([2]);
  });

  it('混合批次中 web 与内部页分别按 URL 命中', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'chrome://newtab/' })
    ];

    const targets = selectRedoTargets(tabs, [record('https://a.com/'), record('chrome://newtab/')]);

    expect(targets.map((tab) => tab.id)).toEqual([1, 2]);
  });

  it('一对一配对：只关掉记录条数那么多个，不误关用户原有的同 URL 副本', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://a.com/' })
    ];

    // 只恢复了一份 → 重做只关一份
    expect(selectRedoTargets(tabs, [record('https://a.com/')]).map((t) => t.id)).toEqual([1]);
    // 恢复了两份 → 两份都关
    expect(
      selectRedoTargets(tabs, [record('https://a.com/'), record('https://a.com/')]).map((t) => t.id)
    ).toEqual([1, 2]);
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

describe('selectRedoTargets 实际恢复身份', () => {
  it('同 URL keeper 排在前面时仍只选择实际恢复的标签', () => {
    // Given 窗口原有 keeper 与本次撤销恢复的标签网址相同
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'https://a.com/' })
    ];

    // When 恢复结果提供实际新建的标签 id
    const targets = selectRedoTargets(tabs, [record('https://a.com/')], {
      restoredTabIds: [2]
    });

    // Then 重做只关闭恢复产物，不按 URL 误关 keeper
    expect(targets.map((tab) => tab.id)).toEqual([2]);
  });

  it('身份集为空或目标已消失时不回退 URL 补位', () => {
    const tabs = [makeTab({ id: 1, url: 'https://a.com/' })];

    expect(selectRedoTargets(tabs, [record('https://a.com/')], { restoredTabIds: [] })).toEqual([]);
    expect(selectRedoTargets(tabs, [record('https://a.com/')], { restoredTabIds: [2] })).toEqual(
      []
    );
  });

  it('身份匹配仍遵守固定标签过滤与显式放行', () => {
    const tabs = [makeTab({ id: 2, url: 'https://a.com/', pinned: true })];

    expect(selectRedoTargets(tabs, [record('https://a.com/')], { restoredTabIds: [2] })).toEqual(
      []
    );
    expect(
      selectRedoTargets(tabs, [record('https://a.com/')], {
        includePinned: true,
        restoredTabIds: [2]
      }).map((tab) => tab.id)
    ).toEqual([2]);
  });
});

describe('撤销「快照恢复」批次时的固定标签（includePinned）', () => {
  /**
   * 要防的失效：快照恢复会按快照里的 pinned 状态**新建固定标签**，而这批标签
   * 正是撤销该批次要关掉的对象。沿用默认（redo 用）的固定豁免会让它们永远
   * 匹配不上：整批都是固定标签时结果为空，撤销入口消失，还会弹出
   * 「这些标签已不在窗口中」这种与事实相反的提示。
   */
  it('Given 恢复出的标签是固定标签 When 撤销 restore 批次 Then 固定标签照常命中', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/', pinned: true }),
      makeTab({ id: 2, url: 'https://b.com/', pinned: true })
    ];

    const targets = selectRedoTargets(tabs, [record('https://a.com/'), record('https://b.com/')], {
      includePinned: true
    });

    expect(targets.map((tab) => tab.id)).toEqual([1, 2]);
  });

  it('Given 同上 When 未显式放行固定（redo 默认）Then 固定标签仍被豁免', () => {
    // 口径必须保持两套：redo 关的是用户自己固定的页面，不能因为给撤销开了口子就连带放宽。
    const tabs = [makeTab({ id: 1, url: 'https://a.com/', pinned: true })];

    expect(selectRedoTargets(tabs, [record('https://a.com/')])).toEqual([]);
  });
});
