import type { UndoBatch, UndoTabRecord } from '@/core/schema/models';
import { DEFAULT_UNDO_STACK_LIMIT } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { NO_GROUP } from '@/core/tab-types';
import { newId } from '@/core/util/id';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 撤销栈：操作记录制而非状态快照制。
 * 只记录重建标签所需的最小信息，撤销 = 用记录重建，因此可跨会话持久化。
 *
 * 默认深度 `DEFAULT_UNDO_STACK_LIMIT` 来自 models.ts 的 schema 默认值，
 * 上限的唯一来源在此（undoStore 实际以 `settings.undoStackLimit` 调用，
 * 此常量仅为未显式传参时的兜底，避免与 schema 双定义而悄悄分叉）。
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

/**
 * 入栈，超限按 FIFO 淘汰。语义委托 `pushBatchWithEvicted`（单一实现），
 * 避免两份裁剪逻辑日后分叉成两种口径。
 */
export function pushBatch(
  batches: UndoBatch[],
  batch: UndoBatch,
  limit = DEFAULT_UNDO_STACK_LIMIT
): UndoBatch[] {
  // slice(-0) 等价于 slice(0)（保留全量），limit 须钳到 ≥1 才能维持淘汰语义。
  return pushBatchWithEvicted(batches, batch, limit).kept;
}

/**
 * 同上，但返回**本次被淘汰的批次**（R18 / S-3）。
 *
 * 定性说明（不要与「隐藏行为」混淆）：撤销栈深度上限本身是**已披露且用户可调**的
 * （models.ts 的 undoStackLimit，范围 5–50，设置页有入口，PRIVACY.md 亦已披露）。
 * 因此这里要补的不是「披露」，而是「淘汰发生那一刻的一次告知」——用户此前只在
 * 打开撤销历史时才发现旧批次不见了。
 *
 * core 层不做 UI 反馈，只把数字交出去，由 store 决定如何提示。
 */
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

/**
 * 撤销批次的可注入入参。
 *
 * `id` / `now` 默认取宿主时钟与随机源。core 其余部分是纯函数，这里刻意留出注入点：
 * 撤销批次需要唯一 id 与时间戳，但把它们硬编码在领域层会让单测不可重现。
 */
export interface CreateUndoBatchOptions {
  /** 关闭发生时的窗口 id（撤销回到原窗口）。 */
  windowId?: number;
  /** 批次创建时间戳（默认 Date.now()）。 */
  now?: number;
  /** 批次 id（默认 crypto.randomUUID()）。 */
  id?: string;
}

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
 *
 * 为什么按 URL 匹配而不是记录 tabId：撤销是「用记录重建标签」，记录里只有
 * URL / 位置 / 状态五元组，没有（也不该有）浏览器 tabId —— 标签 id 在关闭后
 * 即失效，重做发生在恢复之后，此时重建出的标签已是新的 id。
 *
 * 固定标签豁免：与 `closeWithUndo` 的关闭口径一致（用户显式固定的标签不被
 * 批量动作关闭），避免重做误关用户刚固定的页面。
 *
 * 一对一配对而非「按 URL 全量命中」：窗口里可能另有用户本来就开着、从未被本次
 * 撤销恢复出来的同 URL 副本，全量匹配会把它们一并关掉 —— redo 的语义只是
 * 「关掉刚恢复的那批」。
 */
export function selectRedoTargets(
  tabs: readonly TabRecord[],
  records: readonly UndoTabRecord[]
): TabRecord[] {
  const taken = new Set<number>();
  const targets: TabRecord[] = [];
  for (const record of records) {
    const index = tabs.findIndex(
      (tab, position) => !taken.has(position) && !tab.pinned && matchesRecord(tab, record)
    );
    if (index === -1) continue;
    taken.add(index);
    targets.push(tabs[index]!);
  }
  return targets;
}

/** 单条标签是否对应单条撤销记录。 */
function matchesRecord(tab: TabRecord, record: UndoTabRecord): boolean {
  const key = webComparisonKey(record.url, undefined);
  if (key !== null) {
    return webComparisonKey(tab.url, tab.pendingUrl) === key;
  }
  // 内部页（chrome://、about:blank、扩展页）没有 web 比较键：按原始 URL 兜底
  // 比较，否则整批内部页会被判成「重做无对象」——而标签其实还开着。
  // 空 URL 不参与兜底（记录里 URL 缺失不等价于「关掉没有 URL 的标签」）。
  return record.url !== '' && (tab.url ?? '') === record.url;
}
