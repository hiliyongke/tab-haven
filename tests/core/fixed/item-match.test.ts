import { describe, expect, it } from 'vitest';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import type { TabRecord } from '@/core/tab-types';

/**
 * 固定条目 ↔ 标签的匹配口径（全应用唯一来源）。
 *
 * 口径分叉的代价是自相矛盾：UI 显示「未打开」、点「打开全部」却提示「都已打开」、
 * openSavedItem 又新建一个必然失败的标签。
 */
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
    // 回归：比较键对内部页无定义，只按比较键会让此类条目永远匹配不到，
    // openSavedItem 于是走到「新建 + updateTabUrl」并必然失败。
    expect(itemUrlMatchesTab('chrome://settings', tab({ url: 'chrome://settings' }))).toBe(true);
    expect(itemUrlMatchesTab('chrome://settings', tab({ url: 'chrome://extensions' }))).toBe(false);
  });

  it('条目无 URL 时不匹配任何标签（挂起条目走 pendingTabId 分支）', () => {
    expect(itemUrlMatchesTab(undefined, tab({ url: '' }))).toBe(false);
    expect(itemUrlMatchesTab(undefined, tab({}))).toBe(false);
  });
});
