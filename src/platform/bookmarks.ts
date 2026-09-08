import { browser, type Browser } from 'wxt/browser';
import { webComparisonKey } from '@/core/url/UrlInspector';
import type { FixedFolder } from '@/core/schema/models';
import { logDegraded } from '@/platform/diagnostics';

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

/**
 * 只导出 http(s) 条目。
 *
 * 固定条目的 url 在 schema 里是可选且无 scheme 约束的，导入的备份文件可以合法地
 * 携带 `javascript:` / `data:` 串。写进书签后一次点击就在当前站点上下文执行脚本，
 * 因此这里必须白名单过滤（与 Favicon 的 src 校验同一原则）。
 */
export function isExportableUrl(url: string | undefined): url is string {
  return url !== undefined && webComparisonKey(url, undefined) !== null;
}

/** 把固定文件夹导出为书签文件夹（书签栏下，同名冲突自动加序号）。返回导出的条目数。 */
export async function saveFolderToBookmarks(folder: FixedFolder): Promise<number> {
  const bookmarks = browser.bookmarks;
  if (!bookmarks) return 0;
  const items = folder.items.filter((item) => isExportableUrl(item.url));
  if (items.length === 0) return 0;
  try {
    const bar = await bookmarks.get('1'); // BOOKMARKS_BAR_ID
    const barNode = bar[0];
    let name = folder.name;
    if (barNode?.children?.some((child) => child.title === name)) {
      let seq = 2;
      while (barNode.children.some((child) => child.title === `${name} (${seq})`)) seq += 1;
      name = `${name} (${seq})`;
    }
    const created = await bookmarks.create({ parentId: '1', title: name });
    // 串行创建以保证书签顺序与固定空间一致；单条失败不中断其余条目。
    let exported = 0;
    for (const item of items) {
      try {
        await bookmarks.create({
          parentId: created.id,
          title: item.title || item.url,
          url: item.url
        });
        exported += 1;
      } catch (error) {
        logDegraded('bookmarks', '书签条目写入失败，已跳过该条', error);
      }
    }
    return exported;
  } catch (error) {
    // 与 platform 其余文件同纪律：失败必须进诊断导出，不能裸抛给 UI 层。
    logDegraded('bookmarks', '固定文件夹导出为书签失败', error);
    return 0;
  }
}

/**
 * 读取书签栏结构（裸读，不做任何合并/修改）。
 * 定义在 readBookmarkBar 之前，避免 no-use-before-define。
 */
async function readBookmarkBarUnchecked(
  bookmarks: NonNullable<typeof browser.bookmarks>
): Promise<BookmarkBarData> {
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

/** 读取书签栏结构（顶层文件夹 + 直接书签），包裹异常为降级结果。 */
export async function readBookmarkBar(): Promise<BookmarkBarData> {
  const bookmarks = browser.bookmarks;
  if (!bookmarks) return { folders: [], looseLeaves: [] };
  try {
    return await readBookmarkBarUnchecked(bookmarks);
  } catch (error) {
    logDegraded('bookmarks', '书签栏读取失败', error);
    return { folders: [], looseLeaves: [] };
  }
}
