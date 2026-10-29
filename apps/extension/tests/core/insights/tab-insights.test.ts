import { describe, expect, it } from 'vitest';
import type { TabRecord } from '@/core/tab-types';
import { computeInsights, INSIGHT_TOP_N, STALE_TAB_MS } from '@/core/insights/tabInsights';

/** 最小合法 TabRecord 工厂（测试环境不关心 windowId 等字段语义）。 */
function tabOf(partial: Partial<TabRecord> & { id: number }): TabRecord {
  return {
    windowId: 1,
    index: partial.id,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

describe('computeInsights', () => {
  const NOW = 1_700_000_000_000;

  it('重复重灾区：同 URL ≥ 2 份按站点聚合，跨 URL 同站点合并计数', () => {
    const tabs = [
      tabOf({ id: 1, url: 'https://github.com/a', title: 'A' }),
      tabOf({ id: 2, url: 'https://github.com/a', title: 'A dup' }),
      tabOf({ id: 3, url: 'https://github.com/b', title: 'B' }),
      tabOf({ id: 4, url: 'https://github.com/b', title: 'B dup' }),
      tabOf({ id: 5, url: 'https://news.ycombinator.com/x', title: 'X' })
    ];
    const result = computeInsights(tabs, new Set());
    // github.com：两条 URL 各 2 份 → 4 份冗余；ycombinator 仅 1 份不成组
    expect(result.duplicateHotspots).toEqual([{ host: 'github.com', count: 4 }]);
  });

  it('www 归一化：www.github.com 与 github.com 视作同一站点', () => {
    const tabs = [
      tabOf({ id: 1, url: 'https://www.github.com/a' }),
      tabOf({ id: 2, url: 'https://github.com/a' })
    ];
    const result = computeInsights(tabs, new Set());
    expect(result.duplicateHotspots).toEqual([{ host: 'github.com', count: 2 }]);
  });

  it('端口参与页面身份：localhost:3000 与 localhost:8080 的同路径不算重复', () => {
    // 只用 hostname 拼键时这两个（不同服务）被判为同一页面 → 洞察报冗余而
    // planDuplicateCleanup（严格口径）报 0，两条结论自相矛盾。
    const tabs = [
      tabOf({ id: 1, url: 'http://localhost:3000/a' }),
      tabOf({ id: 2, url: 'http://localhost:8080/a' })
    ];
    const result = computeInsights(tabs, new Set());
    expect(result.duplicateHotspots).toEqual([]);
  });

  it('默认端口不参与键：显式写默认端口与省略端口视为同一页面', () => {
    const tabs = [
      tabOf({ id: 1, url: 'http://localhost:80/a' }),
      tabOf({ id: 2, url: 'http://localhost/a' })
    ];
    const result = computeInsights(tabs, new Set());
    expect(result.duplicateHotspots).toEqual([{ host: 'localhost', count: 2 }]);
  });

  it('重复热点上限 Top N 截断', () => {
    const tabs: TabRecord[] = [];
    let id = 0;
    for (let site = 0; site < INSIGHT_TOP_N + 3; site += 1) {
      tabs.push(tabOf({ id: (id += 1), url: `https://site${site}.com/p` }));
      tabs.push(tabOf({ id: (id += 1), url: `https://site${site}.com/p` }));
    }
    const result = computeInsights(tabs, new Set());
    expect(result.duplicateHotspots).toHaveLength(INSIGHT_TOP_N);
  });

  it('休眠候选：排除激活/固定/绑定标签，统计已休眠数', () => {
    const tabs = [
      tabOf({ id: 1, active: true, url: 'https://a.com', lastAccessed: NOW }),
      tabOf({ id: 2, pinned: true, url: 'https://b.com', lastAccessed: NOW }),
      tabOf({ id: 3, url: 'https://c.com', lastAccessed: NOW }),
      tabOf({ id: 4, url: 'https://d.com', lastAccessed: NOW }),
      tabOf({ id: 5, url: 'https://e.com', lastAccessed: NOW, discarded: true }),
      tabOf({
        id: 6,
        url: 'https://f.com',
        lastAccessed: NOW,
        audible: true
      })
    ];
    const result = computeInsights(tabs, new Set([4]));
    // 候选仅 id=3（激活/固定/绑定/播放中全部排除）；id=5 计入已休眠
    expect(result.discardableCount).toBe(1);
    expect(result.discardedCount).toBe(1);
  });

  it('滞留预警：7 天未激活降序排列，固定与已休眠标签豁免', () => {
    const tabs = [
      tabOf({
        id: 1,
        url: 'https://old.com',
        title: '9 天前',
        lastAccessed: NOW - STALE_TAB_MS - 2 * 24 * 3600 * 1000
      }),
      tabOf({
        id: 2,
        url: 'https://older.com',
        title: '30 天前',
        lastAccessed: NOW - 30 * 24 * 3600 * 1000
      }),
      tabOf({ id: 3, url: 'https://pinned.com', pinned: true, lastAccessed: 0 }),
      tabOf({ id: 4, url: 'https://recent.com', lastAccessed: NOW - 1000 }),
      tabOf({ id: 5, url: 'https://discarded.com', lastAccessed: 0, discarded: true })
    ];
    const result = computeInsights(tabs, new Set(), NOW);
    expect(result.staleTabs.map((tab) => tab.id)).toEqual([2, 1]);
    expect(result.staleTabs[0]?.days).toBe(30);
    expect(result.staleTabs[1]?.days).toBe(9);
  });

  it('滞留预警：固定空间绑定标签同样豁免（与休眠候选同口径）', () => {
    const tabs = [
      tabOf({
        id: 1,
        url: 'https://bound.com',
        title: '绑定但滞留',
        lastAccessed: NOW - 30 * 24 * 3600 * 1000
      }),
      tabOf({
        id: 2,
        url: 'https://free.com',
        title: '未绑定且滞留',
        lastAccessed: NOW - 30 * 24 * 3600 * 1000
      })
    ];
    const result = computeInsights(tabs, new Set([1]), NOW);
    // 绑定标签是用户显式保存的资产，不该被建议归档（不能只排除 pinned）
    expect(result.staleTabs.map((tab) => tab.id)).toEqual([2]);
  });

  it('冻结的 lastAccessed 不参与滞留判定：刚切过的老标签不算滞留', () => {
    // 面板侧 lastAccessed 恒为「标签首次出现时」的值（mergeSnapshotTabs 冻结，
    // 供排序稳定用）。若滞留判定沿用冻结值，这个 8 天前打开、刚刚才切过的标签
    // 会被误报成「8 天没动过」——「打开超过 7 天未激活」的口径随之失效。
    const tabs = [
      tabOf({
        id: 1,
        url: 'https://old.com',
        title: '8 天前打开、刚刚切过',
        lastAccessed: NOW - 8 * 24 * 3600 * 1000,
        lastActivatedAt: NOW - 1000
      })
    ];
    const result = computeInsights(tabs, new Set(), NOW);
    expect(result.staleTabs).toEqual([]);
  });

  it('实时激活时刻确实超过 7 天时照常预警（冻结值与实时值同时陈旧）', () => {
    const tabs = [
      tabOf({
        id: 1,
        url: 'https://old.com',
        title: '真的 30 天没动',
        lastAccessed: NOW - 30 * 24 * 3600 * 1000,
        lastActivatedAt: NOW - 30 * 24 * 3600 * 1000
      })
    ];
    const result = computeInsights(tabs, new Set(), NOW);
    expect(result.staleTabs.map((tab) => tab.id)).toEqual([1]);
  });

  it('无 lastAccessed 的标签不参与滞留判定', () => {
    const tabs = [tabOf({ id: 1, url: 'https://x.com' })];
    const result = computeInsights(tabs, new Set());
    expect(result.staleTabs).toEqual([]);
  });

  it('健康窗口：三个维度全部为空', () => {
    const tabs = [tabOf({ id: 1, url: 'https://a.com', lastAccessed: NOW, active: true })];
    const result = computeInsights(tabs, new Set());
    expect(result.duplicateHotspots).toEqual([]);
    expect(result.discardableCount).toBe(0);
    expect(result.staleTabs).toEqual([]);
  });
});
