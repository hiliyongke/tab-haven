import type { FixedFolder, FixedFolderItem, PersistentPin } from '@/core/schema/models';
import { pinIdentity } from '@/core/fixed/PinIdentity';

/**
 * 固定空间纯函数集：不触碰 chrome API，只做数据变换。
 */

/** 从全部文件夹中移除与 URL 相同的条目（URL 全局唯一约束，行为规格 C-3）。 */
export function removeItemsWithUrl(folders: FixedFolder[], url: string): FixedFolder[] {
  return folders.map((folder) => ({
    ...folder,
    items: folder.items.filter((item) => item.url !== url)
  }));
}

/** 新建条目（调用方保证 url 全局唯一后调用）。 */
export function createFolderItem(input: {
  url: string;
  title: string;
  favIconUrl?: string;
  pendingTabId?: number;
  now?: number;
}): FixedFolderItem {
  return {
    id: crypto.randomUUID(),
    url: input.url,
    title: input.title,
    favIconUrl: input.favIconUrl,
    pendingTabId: input.pendingTabId,
    createdAt: input.now ?? Date.now()
  };
}

/** 新建文件夹。 */
export function createFolder(name: string): FixedFolder {
  return {
    id: crypto.randomUUID(),
    name,
    collapsed: false,
    items: []
  };
}

/**
 * 文件夹内条目重排：source 移到 target 之前/之后。
 * 返回新数组（不可变）。
 */
export function reorderFolderItems(
  folder: FixedFolder,
  sourceId: string,
  targetId: string,
  placeAfter: boolean
): FixedFolder {
  const sourceIndex = folder.items.findIndex((item) => item.id === sourceId);
  const targetIndex = folder.items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return folder;

  const items = [...folder.items];
  const [moved] = items.splice(sourceIndex, 1);
  if (!moved) return folder;
  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  items.splice(adjustedTarget + (placeAfter ? 1 : 0), 0, moved);
  return { ...folder, items };
}

/** 文件夹数组重排（文件夹排序）。 */
export function reorderFolders(
  folders: FixedFolder[],
  sourceId: string,
  targetId: string,
  placeAfter: boolean
): FixedFolder[] {
  const sourceIndex = folders.findIndex((folder) => folder.id === sourceId);
  const targetIndex = folders.findIndex((folder) => folder.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return folders;

  const next = [...folders];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return folders;
  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  next.splice(adjustedTarget + (placeAfter ? 1 : 0), 0, moved);
  return next;
}

/** 永久固定标签排序：把 source 移到 target 前/后。 */
export function reorderPins(
  pins: PersistentPin[],
  options: { sourceId: string; targetId: string; placeAfter: boolean }
): PersistentPin[] {
  const { sourceId, targetId, placeAfter } = options;
  const sourceIndex = pins.findIndex((pin) => pin.id === sourceId);
  const targetIndex = pins.findIndex((pin) => pin.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return pins;

  const next = [...pins];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return pins;
  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  next.splice(adjustedTarget + (placeAfter ? 1 : 0), 0, moved);
  return next;
}

/** pin 身份去重（保留首个，过滤后续同身份）。 */
export function dedupePins(pins: PersistentPin[]): PersistentPin[] {
  const seen = new Set<string>();
  const result: PersistentPin[] = [];
  for (const pin of pins) {
    if (seen.has(pin.identity)) continue;
    seen.add(pin.identity);
    result.push(pin);
  }
  return result;
}

/** 由标签生成 pin（identity 归一化）。 */
export function pinFromTab(input: {
  url: string;
  title: string;
  favIconUrl?: string;
}): PersistentPin | null {
  const identity = pinIdentity(input.url);
  if (!identity) return null;
  return { id: crypto.randomUUID(), identity, url: input.url, title: input.title, favIconUrl: input.favIconUrl };
}
