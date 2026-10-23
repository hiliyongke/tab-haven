import type { FixedFolder, FixedFolderItem, PersistentPin } from '@/core/schema/models';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { newId } from '@/core/util/id';

/**
 * 固定空间纯函数集：不触碰 chrome API，只做数据变换。
 *
 * 职责一句话：给定 folders / pins 的当前值，产出下一版值（不落盘、不绑 session）。
 * 分两组：单文件夹/单数组的元素级操作，与覆盖整个 folders 数组的意图级转移。
 */

/** 从全部文件夹中移除与 URL 相同的条目（URL 全局唯一约束，行为规格 C-3）。 */
export function removeItemsWithUrl(folders: FixedFolder[], url: string): FixedFolder[] {
  // 与全局去重同一归一化口径：裸字符串比较会把 `HTTPS://A.COM` 与
  // `https://a.com` 判成两个 URL，唯一性约束（C-3）静默失效。
  const key = webComparisonKey(url, undefined);
  return folders.map((folder) => ({
    ...folder,
    items: folder.items.filter((item) => {
      if (key === null) return item.url !== url;
      const itemKey = item.url === undefined ? null : webComparisonKey(item.url, undefined);
      return itemKey !== key;
    })
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
    id: newId('item'),
    url: input.url,
    title: input.title,
    favIconUrl: input.favIconUrl,
    pendingTabId: input.pendingTabId,
    createdAt: input.now ?? Date.now()
  };
}

/** 新建空文件夹（id 由 core 生成，默认展开）。 */
export function createFolder(name: string): FixedFolder {
  return {
    id: newId('folder'),
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

/**
 * 文件夹排序：把 sourceId 移到 targetId 之前（`placeAfter=false`）或之后。
 * 不可变操作；id 不存在或自移时原样返回。
 */
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
    // 全域 id 唯一口径是 newId（含非安全上下文退化路径），不直用 crypto.randomUUID。
    id: newId('pin'),
    identity,
    url: input.url,
    title: input.title,
    favIconUrl: input.favIconUrl
  };
}

/* ------------------------------------------------------------------------- *
 * 以下是「整个 folders 数组」层面的意图 → 状态转移。
 *
 * 原在 core/commands/folderCommands.ts，与上面的「单文件夹 / 单数组」操作分处
 * 两个目录，但两者都是「输入 folders → 输出下一版 folders」的纯函数，边界说不清。
 * 现合并进本模块：固定空间的纯计算只有一处入口，新增操作不必先判断该放哪个目录。
 * ------------------------------------------------------------------------- */

/**
 * 固定条目的身份键：web 页取完整比较键（查询串与锚点参与身份），
 * 非 web 页降级为原样 URL。
 *
 * 无 URL（挂起条目）时返回 null 而非空串：空串会让所有无 URL 条目撞成同一个键，
 * 于是「第二个挂起条目」会被判为重复项、从**全部文件夹**里静默删除。
 * `FixedFolderItemSchema.url` 是可选的 —— 导入的备份文件可以合法地不含它。
 * 返回 null 让去重逻辑显式跳过这些条目（无法判身份就不参与身份去重）。
 */
export function fixedItemKey(url: string | undefined): string | null {
  if (!url) return null;
  return webComparisonKey(url, undefined) ?? url;
}

/** 不可变重命名；folderId 不存在时原样返回（不新增、不抛错）。 */
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

/** 不可变折叠切换；folderId 不存在时原样返回。 */
export function computeToggleFolderCollapsed(
  folders: FixedFolder[],
  folderId: string
): FixedFolder[] {
  return folders.map((folder) =>
    folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder
  );
}

/**
 * 只重排指定文件夹内的条目，其余文件夹复用原引用
 * （下游以 folder 引用稳定为前提跳过未变化的文件夹行）。
 */
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

/** 文件夹排序（同 `reorderFolders`）：不可变；id 不存在或自移时原样返回。 */
export function computeMoveFolder(
  folders: FixedFolder[],
  op: { sourceId: string; targetId: string; placeAfter: boolean }
): FixedFolder[] {
  return reorderFolders(folders, op.sourceId, op.targetId, op.placeAfter);
}

/**
 * 跨文件夹移动条目（纯）。
 *
 * URL 全局唯一约束下的语义：目标文件夹已存在同 URL 条目时，源条目被**丢弃**
 * （保留目标那份），而不是「不插入也不删除」——后者会让同一 URL 长期存在两份副本，
 * 与固定空间的唯一性不变量冲突。
 */
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
  const itemKey = fixedItemKey(item.url);
  // 无 URL 条目无法判定身份，不参与唯一性去重，直接移动。
  const targetHasDuplicate =
    itemKey !== null && targetFolder.items.some((entry) => fixedItemKey(entry.url) === itemKey);
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
interface AddTabsToFolderInput {
  url: string;
  title: string;
  favIconUrl?: string;
}

/** computeAddTabsToFolder 的纯计算结果（不含任何副作用）。 */
interface ComputeAddTabsToFolderResult {
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
  // 不变量自检：目标文件夹不存在时整单放弃。否则候选/跨文件夹条目会被从
  // 源文件夹移除后无处追加（下方追加只在 folder.id === folderId 分支发生），
  // 表现为「条目被删了但没加到任何地方」的静默丢数据。
  if (!currentFolders.some((folder) => folder.id === folderId)) {
    return {
      next: currentFolders,
      newItems: [],
      movedItems: [],
      duplicateItemIds: new Set(),
      selectedExisting: new Map(),
      comparisonKeys,
      moved: 0,
      targetDuplicates: 0
    };
  }
  const existingByKey = new Map<string, { folderId: string; item: FixedFolderItem }>();
  const duplicateItemIds = new Set<string>();
  for (const folder of currentFolders) {
    for (const item of folder.items) {
      const key = fixedItemKey(item.url);
      // 无 URL 条目（挂起条目 / 导入数据）判不出身份：既不登记为已存在，也不参与去重。
      // 否则它们会共享同一个空键，第二个及之后的条目被当成重复项删除。
      if (key === null) continue;
      if (existingByKey.has(key)) {
        // 清扫范围必须收敛到本次候选：URL 全局唯一不变量下，跨文件夹重复条目
        // 属于历史遗留脏数据，但一次无关拖入不应顺带删除其他文件夹既有的重复
        // 条目（误删面远超单次操作）。只清扫与本次候选同 key 的重复项。
        if (comparisonKeys.has(key)) duplicateItemIds.add(item.id);
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
      if (duplicateItemIds.has(item.id)) return false;
      const key = fixedItemKey(item.url);
      // 无身份条目原样保留：它们不可能是任何候选的重复项。
      if (key === null) return true;
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
