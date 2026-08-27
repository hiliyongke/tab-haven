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

export function createFolder(name: string): FixedFolder {
  return {
    id: crypto.randomUUID(),
    name,
    collapsed: false,
    items: []
  };
}

/**
 * 把数组元素移到目标前/后（不可变；source/target 不存在或相同则原样返回）。
 * 三个 reorder 场景（文件夹条目/文件夹/pin）共用此实现。
 *
 * 契约：no-op 时返回**同一引用**（reorderFolderItems 据此判断未变化并跳过重渲染），
 * 调用方不得原地修改返回值（zustand set 语义下满足）。
 */
function moveElement<T>(options: {
  items: readonly T[];
  sourceId: string;
  targetId: string;
  placeAfter: boolean;
  idOf: (item: T) => string;
}): T[] {
  const { items, sourceId, targetId, placeAfter, idOf } = options;
  const sourceIndex = items.findIndex((item) => idOf(item) === sourceId);
  const targetIndex = items.findIndex((item) => idOf(item) === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items as T[];

  const next = [...items];
  // sourceIndex 有效，splice 必返回一个元素。
  const moved = next.splice(sourceIndex, 1)[0]!;
  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  next.splice(adjustedTarget + (placeAfter ? 1 : 0), 0, moved);
  return next;
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
  const items = moveElement({
    items: folder.items,
    sourceId,
    targetId,
    placeAfter,
    idOf: (item) => item.id
  });
  if (items === folder.items) return folder;
  return { ...folder, items };
}

export function reorderFolders(
  folders: FixedFolder[],
  sourceId: string,
  targetId: string,
  placeAfter: boolean
): FixedFolder[] {
  return moveElement({
    items: folders,
    sourceId,
    targetId,
    placeAfter,
    idOf: (folder) => folder.id
  });
}

/** 永久固定标签排序：把 source 移到 target 前/后。 */
export function reorderPins(
  pins: PersistentPin[],
  options: { sourceId: string; targetId: string; placeAfter: boolean }
): PersistentPin[] {
  const { sourceId, targetId, placeAfter } = options;
  return moveElement({ items: pins, sourceId, targetId, placeAfter, idOf: (pin) => pin.id });
}

/** pin 身份去重：同身份保留首个，过滤后续。 */
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
  return {
    id: crypto.randomUUID(),
    identity,
    url: input.url,
    title: input.title,
    favIconUrl: input.favIconUrl
  };
}
