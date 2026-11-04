import { describe, expect, it } from 'vitest';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { SUBDOMAIN_POLICY } from '@/core/site/SiteKey';
import { buildOpenerTree, isDomainNamedGroupTitle } from '@/core/site/sectionDerivation';

/** 构造最小标签记录。 */
function tab(id: number, index: number, openerTabId?: number): TabRecord {
  return {
    id,
    windowId: 1,
    index,
    active: false,
    pinned: false,
    incognito: false,
    groupId: NO_GROUP,
    ...(openerTabId !== undefined ? { openerTabId } : {})
  };
}

describe('buildOpenerTree', () => {
  it('Given 父子 opener 链 When 构建来源树 Then 按 DFS 前序排列且逐层递增深度', () => {
    const tabs = [tab(1, 0), tab(2, 1, 1), tab(3, 2, 2)];

    const { ordered, depths } = buildOpenerTree(tabs);

    expect(ordered.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(depths.get(1)).toBe(0);
    expect(depths.get(2)).toBe(1);
    expect(depths.get(3)).toBe(2);
  });

  it('Given opener 自引用 When 构建来源树 Then 该标签按根处理（depth 0）', () => {
    const tabs = [tab(1, 0, 1)];

    const { ordered, depths } = buildOpenerTree(tabs);

    expect(ordered.map((item) => item.id)).toEqual([1]);
    expect(depths.get(1)).toBe(0);
  });

  it('Given opener 成环且没有根 When 构建来源树 Then 环上节点仍全部出现在结果中（不丢失）', () => {
    const tabs = [tab(1, 0, 2), tab(2, 1, 1)];

    const { ordered } = buildOpenerTree(tabs);

    expect(ordered.map((item) => item.id).sort()).toEqual([1, 2]);
  });

  it('Given 多个根 When 构建来源树 Then 根按浏览器 index 升序排列', () => {
    const tabs = [tab(3, 2), tab(1, 0), tab(2, 1)];

    const { ordered } = buildOpenerTree(tabs);

    expect(ordered.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});

describe('isDomainNamedGroupTitle', () => {
  it('Given 裸域名标题 When 按子域策略判定 Then 视为域名命名组', () => {
    expect(isDomainNamedGroupTitle('example.com', SUBDOMAIN_POLICY)).toBe(true);
  });

  it('Given 含空格的自定义标题 When 判定 Then 不是域名命名组', () => {
    expect(isDomainNamedGroupTitle('我的 工作', SUBDOMAIN_POLICY)).toBe(false);
  });

  it('Given 空标题 When 判定 Then 不是域名命名组', () => {
    expect(isDomainNamedGroupTitle('', SUBDOMAIN_POLICY)).toBe(false);
  });

  it('Given punycode 形态域名 When 判定 Then 显式排除，不误判为域名组', () => {
    expect(isDomainNamedGroupTitle('xn--fiqs8s', SUBDOMAIN_POLICY)).toBe(false);
  });
});
