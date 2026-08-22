import { describe, expect, it } from 'vitest';
import { reconcileBindings, reconcilePendingItems } from '@/core/fixed/Reconcile';
import { createFolder, createFolderItem } from '@/core/fixed/FolderOps';
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
 * 行为规格（PRD 附录 C-3）：
 *  - 挂起条目：标签导航为 web 后转正（写入 URL/标题、去挂起标记）；
 *  - 挂起标签关闭 → 条目移除；导航未完成时同步标题；
 *  - 绑定维护：清理失效、为未绑定条目自动建立精确 URL 匹配。
 */
describe('reconcilePendingItems', () => {
  it('挂起条目标签导航为 web 后转正', () => {
    const folder = {
      ...createFolder('A'),
      items: [
        {
          ...createFolderItem({ url: '', title: '新标签页' }),
          id: 'item1',
          pendingTabId: 10
        }
      ]
    };
    const tabs = [makeTab({ id: 10, url: 'https://example.com/', title: 'Example' })];
    const { folders, changed } = reconcilePendingItems([folder], tabs);
    const item = folders[0]?.items[0];
    expect(changed).toBe(true);
    expect(item?.pendingTabId).toBeUndefined();
    expect(item?.url).toBe('https://example.com/');
    expect(item?.title).toBe('Example');
  });

  it('挂起标签关闭 → 条目移除', () => {
    const folder = {
      ...createFolder('A'),
      items: [{ ...createFolderItem({ url: '', title: '新标签页' }), id: 'item1', pendingTabId: 99 }]
    };
    const { folders, changed } = reconcilePendingItems([folder], []);
    expect(changed).toBe(true);
    expect(folders[0]?.items).toHaveLength(0);
  });

  it('导航未完成（blank-start）时保留挂起并同步标题', () => {
    const folder = {
      ...createFolder('A'),
      items: [
        { ...createFolderItem({ url: '', title: '新标签页' }), id: 'item1', pendingTabId: 10 }
      ]
    };
    const tabs = [makeTab({ id: 10, url: 'about:blank', title: '加载中…' })];
    const { folders, changed } = reconcilePendingItems([folder], tabs);
    expect(changed).toBe(true);
    expect(folders[0]?.items[0]?.pendingTabId).toBe(10);
    expect(folders[0]?.items[0]?.title).toBe('加载中…');
  });

  it('转正时同 URL 全局去重', () => {
    const folder = {
      ...createFolder('A'),
      items: [
        { ...createFolderItem({ url: '', title: '新标签页' }), id: 'item1', pendingTabId: 10 },
        { ...createFolderItem({ url: 'https://example.com/', title: '旧条目' }), id: 'item2' }
      ]
    };
    const tabs = [makeTab({ id: 10, url: 'https://example.com/', title: 'Example' })];
    const { folders } = reconcilePendingItems([folder], tabs);
    // item2 与转正后的 item1 同 URL：保留先出现的 item1
    expect(folders[0]?.items).toHaveLength(1);
    expect(folders[0]?.items[0]?.id).toBe('item1');
  });
});

describe('reconcileBindings', () => {
  const folderWith = (items: Array<{ id: string; url: string }>) => ({
    ...createFolder('A'),
    items: items.map((item) => ({
      ...createFolderItem({ url: item.url, title: item.url }),
      id: item.id
    }))
  });

  it('清理失效绑定（item 或 tab 已不存在）', () => {
    const folder = folderWith([{ id: 'item1', url: 'https://a.com/' }]);
    const tabs = [makeTab({ id: 1, url: 'https://a.com/' })];
    const result = reconcileBindings([folder], tabs, { item1: 1, itemGone: 5, itemStale: 99 });
    expect(result.bindings['itemGone']).toBeUndefined();
    expect(result.bindings['itemStale']).toBeUndefined();
    expect(result.bindings['item1']).toBe(1);
    expect(result.changed).toBe(true);
  });

  it('为未绑定条目建立精确 URL 匹配绑定', () => {
    const folder = folderWith([{ id: 'item1', url: 'https://a.com/' }]);
    const tabs = [makeTab({ id: 1, url: 'https://a.com/' })];
    const result = reconcileBindings([folder], tabs, {});
    expect(result.bindings['item1']).toBe(1);
    expect(result.changed).toBe(true);
  });

  it('不抢占已被绑定的标签', () => {
    const folder = folderWith([
      { id: 'item1', url: 'https://a.com/' },
      { id: 'item2', url: 'https://a.com/' }
    ]);
    const tabs = [makeTab({ id: 1, url: 'https://a.com/' })];
    const result = reconcileBindings([folder], tabs, { item1: 1 });
    expect(result.bindings['item2']).toBeUndefined();
  });
});
