// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isExportableUrl, readBookmarkBar, saveFolderToBookmarks } from '@/platform/bookmarks';
import { createFolderItem, createFolder } from '@/core/fixed/FolderOps';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import type { FixedFolder } from '@/core/schema/models';

/**
 * 书签集成。
 *
 * 安全要点：`isExportableUrl` 是**唯一**的 URL 白名单闸门。固定条目的 url 在 schema
 * 中无 scheme 约束，导入的备份可合法携带 `javascript:` / `data:` 串；写进书签后一次
 * 点击就在当前站点上下文执行脚本。本文件锁住「只放行 http(s)」这一不变量。
 */

type BookmarksStub = {
  getTree?: () => Promise<unknown[]>;
  get?: (id: string) => Promise<unknown[]>;
  create?: (details: unknown) => Promise<{ id: string }>;
};

function stubBookmarks(stub: BookmarksStub | undefined): void {
  (fakeBrowser as unknown as { bookmarks?: BookmarksStub }).bookmarks = stub;
}

function lastDiagnosticMessage(): string | undefined {
  return readDiagnostics().at(-1)?.message;
}

/** 静音诊断输出：logDegraded 走 console.warn，是被测行为的预期副作用。 */
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function folderWith(name: string, urls: string[]): FixedFolder {
  return {
    ...createFolder(name),
    items: urls.map((url) => createFolderItem({ url, title: `t-${url}` }))
  };
}

describe('isExportableUrl 白名单', () => {
  it('只放行 http / https', () => {
    expect(isExportableUrl('https://a.com/')).toBe(true);
    expect(isExportableUrl('http://a.com/')).toBe(true);
  });

  it('拒绝 javascript: / data: / chrome: 与 undefined（点击即在站点上下文执行脚本）', () => {
    expect(isExportableUrl('javascript:alert(1)')).toBe(false);
    expect(isExportableUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isExportableUrl('chrome://settings')).toBe(false);
    expect(isExportableUrl('about:blank')).toBe(false);
    expect(isExportableUrl(undefined)).toBe(false);
    expect(isExportableUrl('')).toBe(false);
  });
});

describe('readBookmarkBar', () => {
  afterEach(() => {
    stubBookmarks(undefined);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('API 不可用时返回空结构', async () => {
    stubBookmarks(undefined);
    await expect(readBookmarkBar()).resolves.toEqual({ folders: [], looseLeaves: [] });
  });

  it('区分顶层文件夹与散落书签，并递归收集文件夹内叶子', async () => {
    stubBookmarks({
      getTree: async () => [
        {
          id: '0',
          children: [
            {
              id: '1',
              title: 'Bookmarks bar',
              children: [
                {
                  id: '10',
                  title: 'Work',
                  children: [
                    { id: '11', title: 'A', url: 'https://a.com/' },
                    {
                      id: '12',
                      title: 'Nested',
                      children: [{ id: '13', title: 'B', url: 'https://b.com/' }]
                    }
                  ]
                },
                { id: '20', title: 'Loose', url: 'https://loose.com/' }
              ]
            }
          ]
        }
      ]
    });
    const data = await readBookmarkBar();
    expect(data.folders).toEqual([
      {
        name: 'Work',
        leaves: [
          { url: 'https://a.com/', title: 'A' },
          { url: 'https://b.com/', title: 'B' }
        ]
      }
    ]);
    expect(data.looseLeaves).toEqual([{ url: 'https://loose.com/', title: 'Loose' }]);
  });

  it('无标题文件夹回退为 Imported；空文件夹不进结果', async () => {
    stubBookmarks({
      getTree: async () => [
        {
          id: '0',
          children: [
            {
              id: '1',
              children: [
                { id: '10', children: [{ id: '11', title: 'X', url: 'https://x.com/' }] },
                { id: '12', title: 'Empty', children: [] }
              ]
            }
          ]
        }
      ]
    });
    const data = await readBookmarkBar();
    expect(data.folders).toHaveLength(1);
    expect(data.folders[0]?.name).toBe('Imported');
    expect(data.folders[0]?.leaves).toEqual([{ url: 'https://x.com/', title: 'X' }]);
  });

  it('无 title 的叶子被跳过（collectLeaves 要求 title 已定义，浏览器实际总会提供）', async () => {
    stubBookmarks({
      getTree: async () => [
        {
          id: '0',
          children: [
            {
              id: '1',
              children: [
                {
                  id: '10',
                  children: [
                    { id: '11', url: 'https://no-title.com/' },
                    { id: '12', title: 'Has', url: 'https://has.com/' }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    const data = await readBookmarkBar();
    expect(data.folders[0]?.leaves).toEqual([{ url: 'https://has.com/', title: 'Has' }]);
  });

  it('读取异常时降级为空结构并留痕', async () => {
    stubBookmarks({
      getTree: async () => {
        throw new Error('bookmarks api down');
      }
    });
    await expect(readBookmarkBar()).resolves.toEqual({ folders: [], looseLeaves: [] });
    expect(lastDiagnosticMessage()).toContain('书签栏读取失败');
  });
});

describe('saveFolderToBookmarks', () => {
  afterEach(() => {
    stubBookmarks(undefined);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('API 不可用 / 无可导出条目时返回 0（不创建空文件夹）', async () => {
    stubBookmarks(undefined);
    await expect(saveFolderToBookmarks(folderWith('F', ['https://a.com/']))).resolves.toBe(0);

    const create = vi.fn();
    stubBookmarks({ get: async () => [{ id: '1', children: [] }], create });
    await expect(saveFolderToBookmarks(folderWith('F', ['javascript:alert(1)']))).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('导出可导出条目并返回条数（非 http(s) 条目被跳过）', async () => {
    const created: unknown[] = [];
    stubBookmarks({
      get: async () => [{ id: '1', children: [] }],
      create: async (details) => {
        created.push(details);
        const id = `n${created.length}`;
        return { id };
      }
    });
    const exported = await saveFolderToBookmarks(
      folderWith('F', ['https://a.com/', 'javascript:alert(1)', 'https://b.com/'])
    );
    expect(exported).toBe(2);
    // 1 个文件夹 + 2 个书签条目
    expect(created).toHaveLength(3);
    expect(created[0]).toEqual({ parentId: '1', title: 'F' });
  });

  it('书签栏已存在同名文件夹时追加序号', async () => {
    const created: { title?: string }[] = [];
    stubBookmarks({
      get: async () => [{ id: '1', children: [{ title: 'F' }, { title: 'F (2)' }] }],
      create: async (details) => {
        created.push(details as { title?: string });
        return { id: `n${created.length}` };
      }
    });
    await saveFolderToBookmarks(folderWith('F', ['https://a.com/']));
    expect(created[0]?.title).toBe('F (3)');
  });

  it('单个条目写入失败被跳过并留痕，不中断其余条目', async () => {
    let calls = 0;
    stubBookmarks({
      get: async () => [{ id: '1', children: [] }],
      create: async () => {
        calls += 1;
        // 第 1 次建文件夹成功，第 2 次（第一个条目）失败，第 3 次成功
        if (calls === 2) throw new Error('bookmark write failed');
        return { id: `n${calls}` };
      }
    });
    const exported = await saveFolderToBookmarks(
      folderWith('F', ['https://a.com/', 'https://b.com/'])
    );
    expect(exported).toBe(1);
    expect(lastDiagnosticMessage()).toContain('书签条目写入失败');
  });

  it('根级失败（如书签栏不可读）返回 0 并留痕', async () => {
    stubBookmarks({
      get: async () => {
        throw new Error('no bookmarks bar');
      },
      create: async () => ({ id: 'x' })
    });
    await expect(saveFolderToBookmarks(folderWith('F', ['https://a.com/']))).resolves.toBe(0);
    expect(lastDiagnosticMessage()).toContain('固定文件夹导出为书签失败');
  });
});
