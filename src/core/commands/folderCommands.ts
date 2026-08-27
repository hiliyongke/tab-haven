import { createFolderItem, reorderFolderItems, reorderFolders } from '@/core/fixed/FolderOps';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 固定空间「文件夹」相关纯计算（与平台/会话无关）。
 * 只产出下一版 folders + 必要中间量，落盘与绑定等副作用留在 store 层。
 */

/**
 * 固定条目的身份键：web 页取完整比较键（查询串与锚点参与身份），
 * 非 web 页降级为原样 URL，空 URL 为空串。
 */
export function fixedItemKey(url: string | undefined): string {
  if (!url) return '';
  return webComparisonKey(url, undefined) ?? url;
}

export function computeRenameFolder(
  folders: FixedFolder[],
  folderId: string,
  name: string
): FixedFolder[] {
  return folders.map((folder) => (folder.id === folderId ? { ...folder, name } : folder));
}

/** 删除文件夹。绑定释放由调用方另经 session 处理。 */
export function computeRemoveFolder(folders: FixedFolder[], folderId: string): FixedFolder[] {
  return folders.filter((folder) => folder.id !== folderId);
}

export function computeToggleFolderCollapsed(
  folders: FixedFolder[],
  folderId: string
): FixedFolder[] {
  return folders.map((folder) =>
    folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder
  );
}

export function computeReorderFolderItems(
  folders: FixedFolder[],
  op: { folderId: string; sourceId: string; targetId: string; placeAfter: boolean }
): FixedFolder[] {
  return folders.map((folder) =>
    folder.id === op.folderId
      ? reorderFolderItems(folder, op.sourceId, op.targetId, op.placeAfter)
      : folder
  );
}

export function computeMoveFolder(
  folders: FixedFolder[],
  op: { sourceId: string; targetId: string; placeAfter: boolean }
): FixedFolder[] {
  return reorderFolders(folders, op.sourceId, op.targetId, op.placeAfter);
}

/** 跨文件夹移动条目（URL 全局唯一：目标已存在同 URL 时不重复插入，纯）。 */
export function computeMoveFolderItem(
  folders: FixedFolder[],
  op: { sourceFolderId: string; itemId: string; targetFolderId: string }
): FixedFolder[] {
  // 无操作场景返回原引用（与 store 早退一致，避免无谓写盘与重渲染）。
  if (op.sourceFolderId === op.targetFolderId) return folders;
  const sourceFolder = folders.find((folder) => folder.id === op.sourceFolderId);
  const targetFolder = folders.find((folder) => folder.id === op.targetFolderId);
  const item = sourceFolder?.items.find((entry) => entry.id === op.itemId);
  if (!item || !targetFolder) return folders;
  const targetHasDuplicate = targetFolder.items.some(
    (entry) => fixedItemKey(entry.url) === fixedItemKey(item.url)
  );
  return folders.map((folder) => {
    if (folder.id === op.sourceFolderId) {
      return { ...folder, items: folder.items.filter((entry) => entry.id !== op.itemId) };
    }
    if (folder.id === op.targetFolderId && !targetHasDuplicate) {
      return { ...folder, collapsed: false, items: [...folder.items, item] };
    }
    return folder;
  });
}

/** addTabsToFolder 的候选条目输入（已用 webComparisonKey 归一化的 url + 展示信息）。 */
export interface AddTabsToFolderInput {
  url: string;
  title: string;
  favIconUrl?: string;
}

/** computeAddTabsToFolder 的纯计算结果（不含任何副作用）。 */
export interface ComputeAddTabsToFolderResult {
  /** 下一版 folders（已写入新/移动条目、清理重复、目标文件夹展开）。 */
  next: FixedFolder[];
  /** 真正新增的条目（用于建立标签绑定）。 */
  newItems: FixedFolderItem[];
  /** 从其他文件夹移入的条目。 */
  movedItems: FixedFolderItem[];
  /** 与候选 URL 重复、需解绑的旧条目 id。 */
  duplicateItemIds: Set<string>;
  /** 候选 key → 已存在的条目（同文件夹=重复，跨文件夹=移动来源）。 */
  selectedExisting: Map<string, FixedFolderItem>;
  /** 候选 URL 的归一化 key 集合。 */
  comparisonKeys: Set<string>;
  /** 跨文件夹移动条数（结果统计）。 */
  moved: number;
  /** 落在目标文件夹内的重复条数（结果统计，计入 skipped）。 */
  targetDuplicates: number;
}

/**
 * 把一组候选标签合并进目标文件夹的纯计算。
 * 与原 dataStore.addTabsToFolder 的文件夹数组推导完全等价，仅产出、不落盘、不触碰 session。
 */
export function computeAddTabsToFolder(
  currentFolders: FixedFolder[],
  candidates: ReadonlyMap<string, AddTabsToFolderInput>,
  folderId: string
): ComputeAddTabsToFolderResult {
  const comparisonKeys = new Set(candidates.keys());
  const existingByKey = new Map<string, { folderId: string; item: FixedFolderItem }>();
  const duplicateItemIds = new Set<string>();
  for (const folder of currentFolders) {
    for (const item of folder.items) {
      const key = fixedItemKey(item.url);
      if (existingByKey.has(key)) {
        duplicateItemIds.add(item.id);
      } else {
        existingByKey.set(key, { folderId: folder.id, item });
      }
    }
  }

  const selectedExisting = new Map<string, FixedFolderItem>();
  let moved = 0;
  let targetDuplicates = 0;
  for (const key of comparisonKeys) {
    const existing = existingByKey.get(key);
    if (!existing) continue;
    selectedExisting.set(key, existing.item);
    if (existing.folderId === folderId) targetDuplicates += 1;
    else moved += 1;
  }

  // 重复（多文件夹同 URL）条目在全部文件夹中移除；跨/同文件夹的候选条目按规则保留或移除。
  const foldersWithoutCandidates = currentFolders.map((folder) => ({
    ...folder,
    items: folder.items.filter((item) => {
      const key = fixedItemKey(item.url);
      if (duplicateItemIds.has(item.id)) return false;
      if (!comparisonKeys.has(key)) return true;
      // 同文件夹内已存在的条目保持原位（重复拖入同文件夹不应把它移到末尾）。
      return folder.id === folderId && selectedExisting.get(key)?.id === item.id;
    })
  }));
  const newItems = [...candidates.entries()]
    .filter(([key]) => !selectedExisting.has(key))
    .map(([, entry]) => createFolderItem(entry));
  // 仅跨文件夹移动的条目追加到目标文件夹末尾；同文件夹条目已在原位保留。
  const movedItems = [...comparisonKeys]
    .map((key) => existingByKey.get(key))
    .filter(
      (existing): existing is { folderId: string; item: FixedFolderItem } =>
        existing !== undefined && existing.folderId !== folderId
    )
    .map((existing) => existing.item);
  const next = foldersWithoutCandidates.map((folder) =>
    folder.id === folderId
      ? { ...folder, collapsed: false, items: [...folder.items, ...movedItems, ...newItems] }
      : folder
  );

  return {
    next,
    newItems,
    movedItems,
    duplicateItemIds,
    selectedExisting,
    comparisonKeys,
    moved,
    targetDuplicates
  };
}
