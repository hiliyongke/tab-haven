import { describe, expect, it } from 'vitest';
import { deriveSections } from '@/core/site/Sections';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';

function makeTab(id: number, index: number, openerTabId?: number): TabRecord {
  return {
    id,
    windowId: 1,
    index,
    active: false,
    pinned: false,
    incognito: false,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    groupId: NO_GROUP,
    openerTabId
  };
}

function openerTreeOf(tabs: TabRecord[]) {
  const sections = deriveSections({ tabs, groups: [], groupMode: 'opener' });
  const section = sections.find((s) => s.key === 'opener-tree');
  // depths 仅存在于 ungrouped（opener 树）变体上，按字段存在性收窄。
  const depths = section && 'depths' in section ? section.depths : undefined;
  return { tabs: section?.tabs ?? [], depths: depths ?? new Map<number, number>() };
}

/**
 * 来源树（opener 模式）健壮性：
 * 任何 opener 数据异常（成环/自引用/孤儿）都不得导致标签从侧边栏消失，且不允许栈溢出。
 */
describe('buildOpenerTree 健壮性', () => {
  it('正常层级：DFS 前序输出 + 深度正确', () => {
    const tabs = [
      makeTab(1, 0),
      makeTab(2, 1, 1), // opener 为 1
      makeTab(3, 2, 2), // opener 为 2（两层链）
      makeTab(4, 3)
    ];
    const { tabs: ordered, depths } = openerTreeOf(tabs);
    expect(ordered.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(depths.get(1)).toBe(0);
    expect(depths.get(2)).toBe(1);
    expect(depths.get(3)).toBe(2);
    expect(depths.get(4)).toBe(0);
  });

  it('opener 成环（A↔B）：环上标签补为根，全部保留不丢失', () => {
    const tabs = [
      makeTab(1, 0, 2), // 1 的 opener 是 2
      makeTab(2, 1, 1), // 2 的 opener 是 1（成环）
      makeTab(3, 2) // 独立根
    ];
    const { tabs: ordered, depths } = openerTreeOf(tabs);
    // 所有标签都在，且无重复
    expect(ordered.map((t) => t.id).sort()).toEqual([1, 2, 3]);
    expect(depths.get(3)).toBe(0);
    // 环被确定性打破：按 index 较小者（1）补为根，2 挂为其子
    expect(depths.get(1)).toBe(0);
    expect(depths.get(2)).toBe(1);
  });

  it('opener 自引用（openerTabId === id）：按根处理，不死循环', () => {
    const tabs = [makeTab(1, 0, 1), makeTab(2, 1, 1)];
    const { tabs: ordered, depths } = openerTreeOf(tabs);
    expect(ordered.map((t) => t.id)).toEqual([1, 2]);
    expect(depths.get(1)).toBe(0);
    expect(depths.get(2)).toBe(1);
  });

  it('超长 opener 链（5000 层）：迭代遍历不栈溢出', () => {
    const tabs: TabRecord[] = [];
    for (let i = 1; i <= 5000; i += 1) {
      tabs.push(makeTab(i, i - 1, i > 1 ? i - 1 : undefined));
    }
    const { tabs: ordered, depths } = openerTreeOf(tabs);
    expect(ordered).toHaveLength(5000);
    expect(depths.get(5000)).toBe(4999);
  });
});
