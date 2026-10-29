import { describe, expect, it } from 'vitest';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import type { TabRecord } from '@/core/tab-types';

/** 固定条目与标签匹配行为规格：HTTP(S) 按比较键匹配，导航中的标签按 pendingUrl 匹配；
 * 其他协议按原始 URL 比较，无 URL 的条目不匹配。 */
function tab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    url: 'https://a.com/x',
    ...partial
  };
}

describe('itemUrlMatchesTab', () => {
  it('http(s)：按比较键匹配（忽略大小写与默认端口写法）', () => {
    expect(itemUrlMatchesTab('https://a.com/x', tab({ url: 'https://a.com/x' }))).toBe(true);
    expect(itemUrlMatchesTab('https://A.com/x', tab({ url: 'https://a.com/x' }))).toBe(true);
    expect(itemUrlMatchesTab('https://a.com:443/x', tab({ url: 'https://a.com/x' }))).toBe(true);
  });

  it('http(s)：路径/查询不同则不算同一页', () => {
    expect(itemUrlMatchesTab('https://a.com/y', tab({ url: 'https://a.com/x' }))).toBe(false);
  });

  it('导航中的标签按 pendingUrl 匹配', () => {
    expect(
      itemUrlMatchesTab(
        'https://a.com/target',
        tab({ url: 'about:blank', pendingUrl: 'https://a.com/target' })
      )
    ).toBe(true);
  });

  it('非 http(s) 条目退回原样比较（内部页条目仍可命中已打开标签）', () => {
    // 内部页按原始 URL 比较，不使用 HTTP(S) 比较键。
    expect(itemUrlMatchesTab('chrome://settings', tab({ url: 'chrome://settings' }))).toBe(true);
    expect(itemUrlMatchesTab('chrome://settings', tab({ url: 'chrome://extensions' }))).toBe(false);
  });

  it('条目无 URL 时不匹配任何标签（挂起条目走 pendingTabId 分支）', () => {
    expect(itemUrlMatchesTab(undefined, tab({ url: '' }))).toBe(false);
    expect(itemUrlMatchesTab(undefined, tab({}))).toBe(false);
  });
});
