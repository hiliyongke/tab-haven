import { browser, type Browser } from 'wxt/browser';
import type { FixedFolder } from '@/core/schema/models';

/**
 * 书签集成：
 *  - 固定文件夹 → 书签文件夹（一键导出）；
 *  - 书签栏顶层结构 → 固定文件夹（读取端，合并逻辑在 dataStore 执行）。
 * 书签是浏览器第一方数据通道，不触网、不离开设备。
 */

/** 书签栏顶层文件夹 + 直接书签的读取结果。 */
export interface BookmarkBarData {
  folders: { name: string; leaves: { url: string; title: string }[] }[];
  looseLeaves: { url: string; title: string }[];
}

type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode;

function isBookmarkFolder(node: BookmarkTreeNode): boolean {
  return Boolean(node.children);
}

function collectLeaves(nodes: BookmarkTreeNode[]): { url: string; title: string }[] {
  const leaves: { url: string; title: string }[] = [];
  const visit = (node: BookmarkTreeNode): void => {
    if (node.url && node.title !== undefined) leaves.push({ url: node.url, title: node.title });
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return leaves;
}

/** 把固定文件夹导出为书签文件夹（书签栏下，同名冲突自动加序号）。返回导出的条目数。 */
export async function saveFolderToBookmarks(folder: FixedFolder): Promise<number> {
  const bookmarks = browser.bookmarks;
  if (!bookmarks) return 0;
  const items = folder.items.filter((item) => item.url);
  if (items.length === 0) return 0;
  const bar = await bookmarks.get('1'); // BOOKMARKS_BAR_ID
  const barNode = bar[0];
  let name = folder.name;
  if (barNode?.children?.some((child) => child.title === name)) {
    let seq = 2;
    while (barNode.children.some((child) => child.title === `${name} (${seq})`)) seq += 1;
    name = `${name} (${seq})`;
  }
  const created = await bookmarks.create({ parentId: '1', title: name });
  for (const item of items) {
    await bookmarks.create({ parentId: created.id, title: item.title || item.url, url: item.url });
  }
  return items.length;
}

/** 读取书签栏结构（顶层文件夹 + 直接书签），不做任何合并/修改。 */
export async function readBookmarkBar(): Promise<BookmarkBarData> {
  const bookmarks = browser.bookmarks;
  if (!bookmarks) return { folders: [], looseLeaves: [] };
  const tree = await bookmarks.getTree();
  const bar = tree[0]?.children?.[0] ?? tree[0]; // 书签栏通常为第一个顶层节点
  const topLevel = bar?.children ?? [];
  const folders: BookmarkBarData['folders'] = [];
  const looseLeaves: BookmarkBarData['looseLeaves'] = [];
  for (const node of topLevel) {
    if (isBookmarkFolder(node)) {
      const leaves = collectLeaves([node]);
      if (leaves.length > 0) folders.push({ name: node.title || 'Imported', leaves });
    } else if (node.url) {
      looseLeaves.push({ url: node.url, title: node.title || node.url });
    }
  }
  return { folders, looseLeaves };
}
