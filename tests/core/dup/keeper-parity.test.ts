import { describe, expect, it } from 'vitest';
import { DuplicateIndex, KeeperPolicy } from '@/core/dup/DuplicateIndex';
import { rankForKeep } from '@/core/dup/DedupeByUrl';
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

const URL = 'https://a.com/';

/**
 * 行为规格（缺陷 IA-3 —— 两套 keeper 策略口径统一）：
 *  - 「一键清理重复」（KeeperPolicy / planDuplicateCleanup）与「同网址唯一化」
 *    （settings.uniqueUrlTabs / 复用引擎 rankForKeep）是同一句用户预期：
 *    「同一网址只留一个，留最近用过的那个」。
 *  - 因此两者对**同一组标签必须给出同一个 keeper**，否则清理弹窗文案必然与其中
 *    一处行为不符。本文件锁死该不变量（口径单一事实来源：rankForKeep）。
 */
describe('keeper 口径一致性（KeeperPolicy ↔ rankForKeep）', () => {
  /** 同一组标签的两种取法：清理面板侧与复用引擎侧。 */
  function keepersOf(group: TabRecord[]): { cleanup: number; reuse: number } {
    const { keeper } = KeeperPolicy.default.select({ key: 'x', tabs: group });
    return { cleanup: keeper.id, reuse: rankForKeep(group)?.id ?? -1 };
  }

  /** 覆盖每条比较位与常见组合的样本组。 */
  const cases: Record<string, TabRecord[]> = {
    最近访问优先: [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 100 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 900 }),
      makeTab({ id: 3, index: 2, url: URL, lastAccessed: 500 })
    ],
    最近访问压过激活: [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 900 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100, active: true })
    ],
    最近访问压过固定: [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 900 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100, pinned: true })
    ],
    无时间时激活优先: [
      makeTab({ id: 1, index: 0, url: URL, pinned: true }),
      makeTab({ id: 2, index: 1, url: URL, active: true })
    ],
    平局时固定优先: [
      makeTab({ id: 1, index: 0, url: URL, pinned: true }),
      makeTab({ id: 2, index: 1, url: URL })
    ],
    全平时位置靠前: [
      makeTab({ id: 3, index: 7, url: URL }),
      makeTab({ id: 1, index: 2, url: URL }),
      makeTab({ id: 2, index: 5, url: URL })
    ],
    '同位置时 id 大者': [
      makeTab({ id: 1, index: 0, url: URL }),
      makeTab({ id: 2, index: 0, url: URL })
    ],
    混合三项: [
      makeTab({ id: 4, index: 3, url: URL, lastAccessed: 300, pinned: true }),
      makeTab({ id: 5, index: 8, url: URL, lastAccessed: 700 }),
      makeTab({ id: 6, index: 1, url: URL, lastAccessed: 700, active: true })
    ],
    '部分缺失 lastAccessed': [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 500 }),
      makeTab({ id: 2, index: 1, url: URL })
    ],
    固定且激活: [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 100 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100, pinned: true, active: true })
    ],
    乱序传入: [
      makeTab({ id: 9, index: 4, url: URL, lastAccessed: 200 }),
      makeTab({ id: 7, index: 1, url: URL, lastAccessed: 800 }),
      makeTab({ id: 8, index: 9, url: URL, lastAccessed: 800 })
    ]
  };

  for (const [name, group] of Object.entries(cases)) {
    it(`${name}：两处策略给出同一个 keeper`, () => {
      const { cleanup, reuse } = keepersOf(group);
      expect(cleanup).toBe(reuse);
    });
  }

  it('索引层同样一致：每组 keeper 与 rankForKeep 相同', () => {
    const tabs: TabRecord[] = [
      // a.com 三份：最近访问者 id=2 保留
      makeTab({ id: 1, index: 0, url: 'https://a.com/', lastAccessed: 100 }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/', lastAccessed: 900 }),
      makeTab({ id: 3, index: 2, url: 'https://a.com/', lastAccessed: 500 }),
      // b.com 两份：无固定无激活，保留 id=4（位置靠前）
      makeTab({ id: 4, index: 3, url: 'https://b.com/' }),
      makeTab({ id: 5, index: 4, url: 'https://b.com/' }),
      // 单份不成组
      makeTab({ id: 6, index: 5, url: 'https://c.com/' })
    ];
    const index = DuplicateIndex.build(tabs);
    const groups = index.duplicates();
    expect(groups).toHaveLength(2);

    for (const group of groups) {
      expect(KeeperPolicy.default.select(group).keeper.id).toBe(rankForKeep(group.tabs)?.id);
    }

    // 可清理集合 = 全部非 keeper（本例无固定标签，豁免不介入）。
    const removableIds = index.removable(KeeperPolicy.default).map((tab) => tab.id);
    expect(removableIds.sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });

  it('固定豁免是清理侧叠加项，不改变 keeper 选择', () => {
    // keeper 判定统一；固定豁免只影响「哪些副本被关掉」。
    const group = [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 100 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100, pinned: true }),
      makeTab({ id: 3, index: 2, url: URL, lastAccessed: 100, active: true })
    ];
    const { keeper, removable } = KeeperPolicy.default.select({ key: 'x', tabs: group });
    expect(keeper.id).toBe(rankForKeep(group)?.id);
    expect(keeper.id).toBe(3);
    // id=2 固定：非 keeper 且 pinned → 豁免，只清理 id=1。
    expect(removable.map((tab) => tab.id)).toEqual([1]);
  });

  it('pinnedExempt=false 时固定副本也被清理，keeper 仍与 rankForKeep 一致', () => {
    const group = [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 100 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100, pinned: true })
    ];
    const policy = new KeeperPolicy({ pinnedExempt: false });
    const { keeper, removable } = policy.select({ key: 'x', tabs: group });
    expect(keeper.id).toBe(rankForKeep(group)?.id);
    expect(keeper.id).toBe(2); // 全平 → 固定优先
    expect(removable.map((tab) => tab.id)).toEqual([1]);
  });
});
