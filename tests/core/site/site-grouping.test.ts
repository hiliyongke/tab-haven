import { describe, expect, it } from 'vitest';
import { aggregateBySite } from '@/core/site/SiteGrouping';
import { deriveSections } from '@/core/site/Sections';
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
 * 行为规格（PRD 附录 C-4 / FR-D3.1/D3.3 相关）：
 *  - 同站点 ≥ 阈值（默认 2）成组；
 *  - 排除集（手动移出）永不聚合；
 *  - 组按首标签位置排序；
 *  - 临时区派生：固定标签与原生组标签不入临时区。
 */
describe('aggregateBySite', () => {
  it('同站点达到默认阈值成组，单标签归独立', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://cloud.tencent.com/a' }),
      makeTab({ id: 2, index: 1, url: 'https://news.tencent.com/b' }),
      makeTab({ id: 3, index: 2, url: 'https://example.com/c' })
    ];
    const { groups, singles } = aggregateBySite(tabs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key.value).toBe('tencent.com');
    expect(groups[0]?.tabs).toHaveLength(2);
    expect(singles.map((tab) => tab.id)).toEqual([3]);
  });

  it('阈值可配置（FR-D3.2 预留）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://b.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/2' }),
      makeTab({ id: 3, index: 2, url: 'https://b.com/3' })
    ];
    const { groups, singles } = aggregateBySite(tabs, { threshold: 3 });
    expect(groups).toHaveLength(1);
    expect(singles).toHaveLength(0);

    const withThreshold4 = aggregateBySite(tabs, { threshold: 4 });
    expect(withThreshold4.groups).toHaveLength(0);
    expect(withThreshold4.singles).toHaveLength(3);
  });

  it('排除集永不聚合', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/2' })
    ];
    const { groups, singles } = aggregateBySite(tabs, { excludedTabIds: new Set([2]) });
    expect(groups).toHaveLength(0);
    expect(singles.map((tab) => tab.id)).toEqual([2, 1]);
  });

  it('组按首标签位置排序', () => {
    const tabs = [
      makeTab({ id: 1, index: 5, url: 'https://z.com/1' }),
      makeTab({ id: 2, index: 6, url: 'https://z.com/2' }),
      makeTab({ id: 3, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 4, index: 1, url: 'https://a.com/2' })
    ];
    const { groups } = aggregateBySite(tabs);
    expect(groups.map((group) => group.key.value)).toEqual(['a.com', 'z.com']);
  });

  it('子域密度自动展开：同注册域 ≥ 3 子域时各子域独立成组（用户截图场景）', () => {
    // qq.com 下 4 子域各 1 标签 → 自动展开为 4 个 SiteGroup（不再折叠大组）。
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://mail.qq.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://docs.qq.com/' }),
      makeTab({ id: 3, index: 2, url: 'https://v.qq.com/' }),
      makeTab({ id: 4, index: 3, url: 'https://browser.qq.com/' })
    ];
    const { groups, singles } = aggregateBySite(tabs);
    // 4 个标签各占独立组（子域即业务），且每个组达到默认阈值（mail 数量 ≥2 才入组，这里阈值默认 2，所以单标签的进 singles）。
    // 重要断言：不会合并成 qq.com 大组。
    expect(groups.map((g) => g.key.value).sort()).toEqual(['browser.qq.com', 'docs.qq.com', 'v.qq.com'].sort());
    // 单标签子域因未达默认阈值进入 singles（不与大组合并）。
    expect(singles.map((t) => t.id)).toContain(1);
    expect(singles.map((t) => t.id)).toContain(2);
    expect(singles.map((t) => t.id)).toContain(3);
    expect(singles.map((t) => t.id)).toContain(4);
    // 关键断言：QQ 域没有形成聚合大组（子域各自独立、阈值与算法自动判断）。
    expect(groups.find((g) => g.key.value === 'qq.com')).toBeUndefined();
  });

  it('子域密度自动展开：同子域 ≥ 阈值才入组，单标签子域进 singles', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://mail.qq.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://mail.qq.com/2' }),
      makeTab({ id: 3, index: 2, url: 'https://v.qq.com/' }),
      makeTab({ id: 4, index: 3, url: 'https://docs.qq.com/' })
    ];
    const { groups, singles } = aggregateBySite(tabs);
    // mail.qq.com 2 个标签 → 独立成组；其余单标签子域 → singles。
    const mailGroup = groups.find((g) => g.key.value === 'mail.qq.com');
    expect(mailGroup).toBeDefined();
    expect(mailGroup?.subgroups).toHaveLength(0);
    expect(singles.map((t) => t.id).sort()).toEqual([3, 4]);
  });

  it('阈值 1：单标签站点也独立成组（不落未分组）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://single-site.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://pair.com/a' }),
      makeTab({ id: 3, index: 2, url: 'https://pair.com/b' })
    ];
    const { groups, singles } = aggregateBySite(tabs, { threshold: 1 });
    // 单标签站点成组，双标签站点成组，无 singles。
    expect(singles).toHaveLength(0);
    expect(groups.map((g) => g.key.value).sort()).toEqual(['pair.com', 'single-site.com']);
  });

  it('阈值 1 + 子域自动展开：单标签子域也各自成组', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://mail.qq.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://v.qq.com/' }),
      makeTab({ id: 3, index: 2, url: 'https://docs.qq.com/' })
    ];
    const { groups, singles } = aggregateBySite(tabs, { threshold: 1 });
    // 3 个不同子域 → 自动展开为 3 个独立组（阈值 1 下无 singles）。
    expect(singles).toHaveLength(0);
    expect(groups.map((g) => g.key.value).sort()).toEqual(['docs.qq.com', 'mail.qq.com', 'v.qq.com']);
  });
});

describe('deriveSections', () => {
  it('固定标签独立成区置顶，原生组标签保留在原生 section', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/1', pinned: true }),
      makeTab({ id: 3, index: 2, url: 'https://c.com/1', groupId: 5 }),
      makeTab({ id: 4, index: 3, url: 'https://c.com/2', groupId: 5 })
    ];
    const sections = deriveSections({
      tabs,
      groups: [{ id: 5, title: '调研', color: 'blue' }]
    });
    expect(sections[0]?.kind).toBe('pinned');
    expect(sections[0]?.tabs.map((tab) => tab.id)).toEqual([2]);
    expect(sections[1]?.kind).toBe('native');
    expect(sections[1]?.tabs.map((tab) => tab.id)).toEqual([3, 4]);
    expect(sections[2]?.kind).toBe('ungrouped');
    expect(sections[2]?.tabs.map((tab) => tab.id)).toEqual([1]);
  });

  it('多级子域名智能分组：同注册域多子域折叠为子分组（FR-D3.1 层级）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://mail.google.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://mail.google.com/2' }),
      makeTab({ id: 3, index: 2, url: 'https://drive.google.com/1' }),
      makeTab({ id: 4, index: 3, url: 'https://drive.google.com/2' })
    ];
    const sections = deriveSections({ tabs, groups: [] });
    const site = sections.find((s) => s.kind === 'site');
    expect(site?.kind).toBe('site');
    // 标题用注册域（子域折叠展示）
    expect(site && site.kind === 'site' && site.title).toBe('google.com');
    expect(site && site.kind === 'site' && site.subgroups).toHaveLength(2);
    const mail = site && site.kind === 'site' ? site.subgroups.find((g) => g.subdomain === 'mail') : undefined;
    expect(mail?.tabs.map((tab) => tab.id)).toEqual([1, 2]);
  });

  it('多级子域名智能识别：a.b.example.com 与 example.com 同属注册域归组', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://app.staging.example.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://example.com/2' })
    ];
    const { groups } = aggregateBySite(tabs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key.value).toBe('example.com');
  });

  it('原生组按组内首标签位置排序', () => {
    const tabs = [
      makeTab({ id: 1, index: 5, url: 'https://z.com/1', groupId: 20 }),
      makeTab({ id: 2, index: 6, url: 'https://z.com/2', groupId: 20 }),
      makeTab({ id: 3, index: 0, url: 'https://a.com/1', groupId: 10 }),
      makeTab({ id: 4, index: 1, url: 'https://a.com/2', groupId: 10 })
    ];
    const sections = deriveSections({
      tabs,
      groups: [
        { id: 20, title: 'Z' },
        { id: 10, title: 'A' }
      ]
    });
    expect(sections[0]?.kind).toBe('native');
    expect(sections[0]?.title).toBe('A');
    expect(sections[1]?.title).toBe('Z');
  });

  it('同站点聚合为 site section，单标签归未分组', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/1' }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/2' }),
      makeTab({ id: 3, index: 2, url: 'https://b.com/1' })
    ];
    const sections = deriveSections({ tabs, groups: [] });
    expect(sections[0]?.kind).toBe('site');
    expect(sections[0]?.title).toBe('a.com');
    expect(sections[1]?.kind).toBe('ungrouped');
    expect(sections[1]?.tabs).toHaveLength(1);
  });

  it('排除集不进入任何 section', () => {
    const tabs = [makeTab({ id: 1, index: 0, url: 'https://a.com/1' })];
    const sections = deriveSections({ tabs, groups: [], excludedTabIds: new Set([1]) });
    expect(sections).toHaveLength(0);
  });

  it('空输入返回空 sections', () => {
    expect(deriveSections({ tabs: [], groups: [] })).toHaveLength(0);
  });
});
