import type { UndoBatch, UndoTabRecord } from '@/core/schema/models';
import { DEFAULT_UNDO_STACK_LIMIT } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';
import { newId } from '@/core/util/id';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 撤销栈：操作记录制（只记重建标签的最小信息），可跨会话持久化。
 * DEFAULT_UNDO_STACK_LIMIT 仅为未传参时的兜底；实际以 settings.undoStackLimit 为准。
 */

/** 从标签快照生成撤销记录（五元组 + 组名）。 */
export function toUndoTabRecord(
  tab: TabRecord,
  groupNameById: ReadonlyMap<number, string | undefined>
): UndoBatch['entries'][number] {
  return {
    url: tab.url ?? '',
    index: tab.index,
    pinned: tab.pinned,
    muted: Boolean(tab.muted),
    groupId: tab.groupId,
    groupName: tab.groupId !== NO_GROUP ? groupNameById.get(tab.groupId) : undefined
  };
}

/** 入栈，超限按 FIFO 淘汰；语义委托 pushBatchWithEvicted。 */
export function pushBatch(
  batches: UndoBatch[],
  batch: UndoBatch,
  limit = DEFAULT_UNDO_STACK_LIMIT
): UndoBatch[] {
  // slice(-0) 等价于 slice(0)（保留全量），limit 须钳到 ≥1 才能维持淘汰语义。
  return pushBatchWithEvicted(batches, batch, limit).kept;
}

/** 入栈并返回本次被淘汰的批次，供 store 在淘汰发生时提示用户。 */
export function pushBatchWithEvicted(
  batches: UndoBatch[],
  batch: UndoBatch,
  limit = DEFAULT_UNDO_STACK_LIMIT
): { kept: UndoBatch[]; evicted: UndoBatch[] } {
  const cap = Math.max(1, Math.floor(limit));
  const next = [...batches, batch];
  const cut = Math.max(0, next.length - cap);
  return { kept: next.slice(cut), evicted: next.slice(0, cut) };
}

/** 弹栈：返回 [最新批次, 剩余批次]。 */
export function popBatch(batches: UndoBatch[]): [UndoBatch | undefined, UndoBatch[]] {
  const latest = batches.at(-1);
  return [latest, batches.slice(0, -1)];
}

/** id / now 可注入，让单测可重现（默认取宿主时钟与随机源）。 */
interface CreateUndoBatchOptions {
  /** 关闭发生时的窗口 id（撤销回到原窗口）。 */
  windowId?: number;
  /** 批次创建时间戳（默认 Date.now()）。 */
  now?: number;
  /** 批次 id（默认 crypto.randomUUID()）。 */
  id?: string;
}

/** 构造撤销批次：kind 决定恢复方式，entries 是影响的全部对象。 */
export function createUndoBatch(
  kind: string,
  entries: UndoBatch['entries'],
  options: CreateUndoBatchOptions = {}
): UndoBatch {
  return {
    id: options.id ?? newId('undo'),
    kind,
    createdAt: options.now ?? Date.now(),
    windowId: options.windowId,
    entries
  };
}

/**
 * 重做目标：当前窗口中 URL 与撤销记录相同的标签。
 * 按 URL 匹配（记录不含 tabId，标签 id 关闭后失效）；一对一配对，只关刚恢复的那批，
 * 不误伤窗口里本就开着的同 URL 副本。
 * includePinned=true 用于撤销「快照恢复」批次：那批固定标签正是要关掉的对象，须纳入匹配。
 */
export function selectRedoTargets(
  tabs: readonly TabRecord[],
  records: readonly UndoTabRecord[],
  options: { includePinned?: boolean } = {}
): TabRecord[] {
  const includePinned = options.includePinned ?? false;
  const taken = new Set<number>();
  const targets: TabRecord[] = [];
  // 按比较键建索引（O(n+m)）。内部页无 web 键，另按原始 URL 兜底；空 URL 不参与。
  const byWebKey = new Map<string, number[]>();
  const byRawUrl = new Map<string, number[]>();
  const index = (map: Map<string, number[]>, key: string, position: number): void => {
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [position]);
    else bucket.push(position);
  };
  tabs.forEach((tab, position) => {
    if (!includePinned && tab.pinned) return;
    const webKey = webComparisonKey(tab.url, tab.pendingUrl);
    if (webKey !== null) index(byWebKey, webKey, position);
    const rawUrl = tab.url ?? '';
    if (rawUrl !== '') index(byRawUrl, rawUrl, position);
  });

  for (const record of records) {
    // web 键可用时按 web 键，内部页回落到原始 URL。
    const recordWebKey = webComparisonKey(record.url, undefined);
    const candidates =
      recordWebKey !== null
        ? byWebKey.get(recordWebKey)
        : record.url !== ''
          ? byRawUrl.get(record.url)
          : undefined;
    if (candidates === undefined) continue;
    const position = candidates.find((candidate) => !taken.has(candidate));
    if (position === undefined) continue;
    taken.add(position);
    const tab = tabs[position];
    if (tab === undefined) continue;
    targets.push(tab);
  }
  return targets;
}
