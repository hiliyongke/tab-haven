import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 固定条目 URL 是否命中某个标签 —— 固定空间「条目 ↔ 标签」判定的唯一口径。
 *
 * 主口径是比较键（大小写 / 默认端口写法不同也算同一页）；但比较键只对 http(s) 有定义，
 * 而 `FixedFolderItem.url` 在 schema 里是可选且无 scheme 约束的 —— 遗留数据与早期导入
 * 的内容里可能存在 chrome:// 等内部页条目，对它们必须退回原样字符串比较。
 *
 * 消费方（固定空间所有相关判定，口径分叉就会出现自相矛盾）：
 *  - `stores/data/folderSlice.openSavedItem`（打开条目的步骤 2）
 *  - `ui/fixed/FolderRow`（运行时索引 / 打开全部 / 定位展开）
 *  - `ui/fixed/FolderItemRow`（行内关闭）
 */
export function itemUrlMatchesTab(itemUrl: string | undefined, tab: TabRecord): boolean {
  if (itemUrl === undefined) return false;
  const itemKey = webComparisonKey(itemUrl, undefined);
  if (itemKey !== null) return webComparisonKey(tab.url, tab.pendingUrl) === itemKey;
  return tab.url === itemUrl;
}
