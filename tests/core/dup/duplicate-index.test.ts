import { describe, expect, it } from 'vitest';
import { DuplicateIndex, KeeperPolicy } from '@/core/dup/DuplicateIndex';
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

/**
 * 行为规格（PRD 附录 C-8）：
 *  - 同一完整网址 ≥ 2 份视为重复；
 *  - 一键清理保留：当前激活 > 已固定 > 位置靠前；
 *  - 固定标签豁免清理。
 */
describe('DuplicateIndex', () => {
  it('按完整网址精确分组，仅 ≥ 2 份成组', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/' }),
      makeTab({ id: 3, index: 2, url: 'https://b.com/' })
    ];
    const index = DuplicateIndex.build(tabs);
    expect(index.duplicates()).toHaveLength(1);
    expect(index.duplicates()[0]?.tabs).toHaveLength(2);
    expect(index.counts().get('https://b.com/')).toBe(1);
  });

  it('内部页与空白页不参与分组', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'chrome://newtab/' }),
      makeTab({ id: 2, index: 1, url: 'chrome://newtab/' })
    ];
    expect(DuplicateIndex.build(tabs).duplicates()).toHaveLength(0);
  });

  it('导航中的标签按 pending 地址参与分组', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'about:blank', pendingUrl: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/' })
    ];
    expect(DuplicateIndex.build(tabs).duplicates()).toHaveLength(1);
  });
});

describe('KeeperPolicy', () => {
  const tabs = (url: string) => [
    makeTab({ id: 1, index: 0, url }),
    makeTab({ id: 2, index: 1, url }),
    makeTab({ id: 3, index: 2, url })
  ];

  it('保留当前激活标签', () => {
    const group = tabs('https://a.com/');
    group[1]!.active = true;
    const { keeper, removable } = KeeperPolicy.default.select({ key: 'x', tabs: group });
    expect(keeper.id).toBe(2);
    expect(removable.map((tab) => tab.id)).toEqual([1, 3]);
  });

  it('无激活时保留固定标签', () => {
    const group = tabs('https://a.com/');
    group[1]!.pinned = true;
    const { keeper, removable } = KeeperPolicy.default.select({ key: 'x', tabs: group });
    expect(keeper.id).toBe(2);
    expect(removable.map((tab) => tab.id)).toEqual([1, 3]);
  });

  it('无激活无固定时保留位置最靠前者', () => {
    const { keeper, removable } = KeeperPolicy.default.select({
      key: 'x',
      tabs: tabs('https://a.com/')
    });
    expect(keeper.id).toBe(1);
    expect(removable.map((tab) => tab.id)).toEqual([2, 3]);
  });

  it('固定标签（非 keeper）豁免清理', () => {
    const group = tabs('https://a.com/');
    group[1]!.pinned = true;
    group[2]!.active = true;
    const { keeper, removable } = KeeperPolicy.default.select({ key: 'x', tabs: group });
    expect(keeper.id).toBe(3);
    expect(removable.map((tab) => tab.id)).toEqual([1]);
  });

  it('removable 汇总应用策略', () => {
    const groupTabs = tabs('https://a.com/');
    groupTabs[0]!.active = true;
    const removable = DuplicateIndex.build(groupTabs).removable(KeeperPolicy.default);
    expect(removable.map((tab) => tab.id)).toEqual([2, 3]);
  });

  it('乱序输入时仍保留 index 最小者（不依赖传入顺序）', () => {
    // 传入顺序乱序：兜底「位置靠前」必须按 index 判定，行为确定。
    const group = [
      makeTab({ id: 3, index: 7, url: 'https://a.com/' }),
      makeTab({ id: 1, index: 2, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 5, url: 'https://a.com/' })
    ];
    const { keeper, removable } = KeeperPolicy.default.select({ key: 'x', tabs: group });
    expect(keeper.id).toBe(1);
    expect(removable.map((tab) => tab.id).sort()).toEqual([2, 3]);
  });
});
