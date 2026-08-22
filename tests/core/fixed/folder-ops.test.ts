import { describe, expect, it } from 'vitest';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import {
  createFolder,
  createFolderItem,
  dedupePins,
  pinFromTab,
  removeItemsWithUrl,
  reorderFolderItems,
  reorderFolders
} from '@/core/fixed/FolderOps';

/**
 * 行为规格（PRD 附录 C-2/C-3）：
 *  - pin 身份归一化：去 www/小写/保留端口，同站点不同路径同身份；
 *  - 同一 URL 在文件夹体系内全局唯一；
 *  - 文件夹内条目排序与文件夹排序。
 */
describe('pinIdentity', () => {
  it('去 www 前缀与小写', () => {
    expect(pinIdentity('https://WWW.Example.com/a')).toBe('example.com');
    expect(pinIdentity('https://Example.com/b')).toBe('example.com');
  });

  it('保留端口（不同端口不同身份）', () => {
    expect(pinIdentity('https://example.com:8443/a')).toBe('example.com:8443');
    expect(pinIdentity('https://example.com/a')).toBe('example.com');
  });

  it('同站点不同路径同身份', () => {
    expect(pinIdentity('https://example.com/a')).toBe(pinIdentity('https://example.com/b/c'));
  });

  it('非 http(s) 返回 null', () => {
    expect(pinIdentity('chrome://newtab/')).toBeNull();
    expect(pinIdentity('about:blank')).toBeNull();
  });
});

describe('pinFromTab / dedupePins', () => {
  it('标签生成 pin 并身份去重', () => {
    const a = pinFromTab({ url: 'https://example.com/a', title: 'A' });
    const b = pinFromTab({ url: 'https://example.com/b', title: 'B' });
    expect(a?.identity).toBe(b?.identity);
    expect(dedupePins([a!, b!])).toHaveLength(1);
  });
});

describe('FolderOps', () => {
  it('removeItemsWithUrl 全局移除同 URL 条目', () => {
    const folderA = {
      ...createFolder('A'),
      items: [createFolderItem({ url: 'https://a.com/', title: 'A1' })]
    };
    const folderB = {
      ...createFolder('B'),
      items: [createFolderItem({ url: 'https://a.com/', title: 'B1' })]
    };
    const next = removeItemsWithUrl([folderA, folderB], 'https://a.com/');
    expect(next[0]?.items).toHaveLength(0);
    expect(next[1]?.items).toHaveLength(0);
  });

  it('reorderFolderItems：移动到目标之前/之后', () => {
    const folder = {
      ...createFolder('A'),
      items: ['x', 'y', 'z'].map((title) => ({
        ...createFolderItem({ url: `https://${title}.com/`, title }),
        id: title
      }))
    };
    const before = reorderFolderItems(folder, 'x', 'z', false);
    expect(before.items.map((item) => item.title)).toEqual(['y', 'x', 'z']);
    const after = reorderFolderItems(folder, 'x', 'z', true);
    expect(after.items.map((item) => item.title)).toEqual(['y', 'z', 'x']);
  });

  it('reorderFolders：文件夹排序', () => {
    const folders = ['a', 'b', 'c'].map((name) => ({ ...createFolder(name), id: name }));
    const next = reorderFolders(folders, 'a', 'c', false);
    expect(next.map((folder) => folder.name)).toEqual(['b', 'a', 'c']);
  });
});
