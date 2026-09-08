import { describe, it, expect } from 'vitest';
import {
  computeAddTabsToFolder,
  computeMoveFolderItem,
  computeRemoveFolder,
  computeRenameFolder,
  computeToggleFolderCollapsed,
  fixedItemKey
} from '@/core/commands/folderCommands';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';

function item(id: string, url: string): FixedFolderItem {
  return { id, url, title: url, createdAt: 1 };
}
/**
 * 候选 Map 的键必须是**已归一化**的比较键——与生产调用方
 * （dataStore.addTabsToFolder 用 webComparisonKey 作键）保持同一口径。
 * 直接拿原始 URL 当键，会与条目侧 fixedItemKey 归出来的键对不上。
 */
function candidates(...urls: string[]): Map<string, { url: string; title: string }> {
  return new Map(urls.map((url) => [fixedItemKey(url) ?? url, { url, title: url }] as const));
}
function folder(
  id: string,
  name: string,
  options: { items?: FixedFolderItem[]; collapsed?: boolean } = {}
): FixedFolder {
  return { id, name, items: options.items ?? [], collapsed: options.collapsed ?? false };
}

describe('folderCommands 纯计算', () => {
  it('computeRenameFolder 仅改名字段', () => {
    const folders = [folder('a', 'A')];
    expect(computeRenameFolder(folders, 'a', 'Z')[0]?.name).toBe('Z');
  });

  it('computeRemoveFolder 删除目标且不动其余', () => {
    const next = computeRemoveFolder([folder('a', 'A'), folder('b', 'B')], 'a');
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('b');
  });

  it('computeToggleFolderCollapsed 翻转折叠态', () => {
    expect(
      computeToggleFolderCollapsed([folder('a', 'A', { items: [], collapsed: false })], 'a')[0]
        ?.collapsed
    ).toBe(true);
  });

  it('computeMoveFolderItem 跨文件夹移动并展开目标', () => {
    const folders = [
      folder('a', 'A', { items: [item('i1', 'https://x.com')] }),
      folder('b', 'B', { items: [], collapsed: true })
    ];
    const next = computeMoveFolderItem(folders, {
      sourceFolderId: 'a',
      itemId: 'i1',
      targetFolderId: 'b'
    });
    expect(next.find((f) => f.id === 'a')?.items).toHaveLength(0);
    const target = next.find((f) => f.id === 'b');
    expect(target?.items?.map((i) => i.id)).toEqual(['i1']);
    expect(target?.collapsed).toBe(false);
  });

  it('computeMoveFolderItem 目标已含同 URL 则仅从源移除（去重）', () => {
    const folders = [
      folder('a', 'A', { items: [item('i1', 'https://x.com')] }),
      folder('b', 'B', { items: [item('i2', 'https://x.com')] })
    ];
    const next = computeMoveFolderItem(folders, {
      sourceFolderId: 'a',
      itemId: 'i1',
      targetFolderId: 'b'
    });
    expect(next.find((f) => f.id === 'a')?.items).toHaveLength(0);
    expect(next.find((f) => f.id === 'b')?.items?.map((i) => i.id)).toEqual(['i2']);
  });

  it('computeMoveFolderItem 同文件夹内移动为 no-op（返回原引用）', () => {
    const folders = [folder('a', 'A', { items: [item('i1', 'u')] })];
    expect(
      computeMoveFolderItem(folders, { sourceFolderId: 'a', itemId: 'i1', targetFolderId: 'a' })
    ).toBe(folders);
  });

  it('computeAddTabsToFolder 新增条目', () => {
    const folders = [folder('a', 'A', { items: [item('i1', 'https://a.com')] })];
    const res = computeAddTabsToFolder(folders, candidates('https://b.com'), 'a');
    expect(res.newItems.map((i) => i.url)).toEqual(['https://b.com']);
    expect(res.newItems).toHaveLength(1);
    expect(res.moved).toBe(0);
  });

  it('computeAddTabsToFolder 同文件夹重复 URL 计入 targetDuplicates 且不新增', () => {
    const folders = [folder('a', 'A', { items: [item('i1', 'https://a.com')] })];
    const res = computeAddTabsToFolder(folders, candidates('https://a.com'), 'a');
    expect(res.newItems).toHaveLength(0);
    expect(res.targetDuplicates).toBe(1);
    // 原条目保留原位（重复拖入同文件夹不移动）
    expect(res.next.find((f) => f.id === 'a')?.items?.map((i) => i.id)).toEqual(['i1']);
  });

  it('computeAddTabsToFolder 跨文件夹重复 URL 触发移动', () => {
    const folders = [
      folder('a', 'A', { items: [item('i1', 'https://a.com')] }),
      folder('b', 'B', { items: [item('i2', 'https://b.com')] })
    ];
    const res = computeAddTabsToFolder(folders, candidates('https://b.com'), 'a');
    expect(res.next.find((f) => f.id === 'a')?.items?.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(res.next.find((f) => f.id === 'b')?.items).toHaveLength(0);
    expect(res.moved).toBe(1);
  });

  it('fixedItemKey 以完整 web URL 为身份键（查询串参与身份）', () => {
    // 基线规则「同一 URL 全局唯一」为精确 URL 匹配；查询串/锚点不同即不同条目。
    // 归一化匹配（忽略跟踪参数/锚点）属 FR-D8.2（V1.2）范围，届时再扩展本用例。
    expect(fixedItemKey('https://x.com/?a=1')).not.toBe(fixedItemKey('https://x.com/?b=2'));
    expect(fixedItemKey('https://x.com/?a=1')).toBe(fixedItemKey('https://x.com/?a=1'));
    // 无 URL（挂起 / 导入数据）返回 null：判不出身份就不给身份键。
    // 历史上这里返回空串，导致所有无 URL 条目撞成同一个键、互相判为重复而被删除。
    expect(fixedItemKey(undefined)).toBeNull();
    // 非 web 页（内部页）降级原样返回
    expect(fixedItemKey('chrome://newtab')).toBe('chrome://newtab');
  });

  it('多个无 URL 条目不会互相判为重复（防静默删除回归）', () => {
    // 回归：fixedItemKey 曾对无 url 条目返回 ''，使第二个及之后的条目被
    // 归入 duplicateItemIds，从**全部文件夹**里移除 —— 一次导入即丢数据。
    const folders = [
      folder('a', 'A', {
        items: [
          { id: 'p1', title: '待定1', createdAt: 1 },
          { id: 'p2', title: '待定2', createdAt: 2 }
        ]
      }),
      folder('b', 'B', { items: [{ id: 'p3', title: '待定3', createdAt: 3 }] })
    ];
    const res = computeAddTabsToFolder(folders, candidates('https://new.com'), 'a');
    const ids = res.next.flatMap((f) => f.items.map((i) => i.id));
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
    expect(ids).toContain('p3');
    expect(res.duplicateItemIds.size).toBe(0);
  });
});
