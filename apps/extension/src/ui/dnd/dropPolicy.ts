/**
 * 拖拽投放契约：**唯一**决定「什么能放到哪里」的地方。
 *
 * 拖拽有三个消费方，过去它们各自判断投放能力，必然漂移：
 *  1. 落点视觉（GroupCard / FixedArea / PinnedStrip / FolderItemRow）—— 决定高不高亮；
 *  2. 松手执行（useTabDragHandlers）—— 决定做不做、做什么；
 *  3. 拒绝反馈 —— 决定提示什么。
 * 「高亮了却不动」「没高亮却真的动了」全部源于 1 与 2 用了两套判断。
 *
 * 这里把判断收敛成两级：
 *  - `classifyDrop`：纯结构判定（源类型 × 落点类型），与设置无关。视觉层用它，
 *    因此「亮不亮」与「放不放得进去」永远同源。
 *  - `resolveDrop`：结构判定 + 全局闸门（导入事务 / 排序开关 / 视图语义 / 虚拟化）。
 *    执行层用它，被闸门拦下的动作必定附带原因，不再静默。
 *
 * 分层：ui 层纯函数，零 chrome / DOM / React。
 */

import {
  DragType,
  FIXED_AREA_DROPPABLE,
  PINNED_STRIP_DROPPABLE,
  type DragData,
  type DropTargetData
} from './types';

/** 落点身份：draggable 的 id + data（与 dnd-kit 的 `over` 一一对应）。 */
export interface DropTarget {
  id: string | number;
  data?: DropTargetData;
}

/** 松手后要执行的动作。执行层按 kind 分派，不再重复判断可行性。 */
export type DropAction =
  /** 临时区标签排序（受排序开关 / 视图模式 / 虚拟化闸门约束）。 */
  | { kind: 'reorder-tabs' }
  /** 浏览器原生置顶标签排序（磁贴间，走 chrome.tabs.move）。 */
  | { kind: 'reorder-pinned-tabs' }
  /** 标签拖到原生分组头：加入该组。 */
  | { kind: 'join-group'; groupId: number }
  /** 标签 / 整组拖到收藏夹（文件夹卡或其条目）。 */
  | { kind: 'move-tabs-to-folder'; folderId: string }
  /** 标签 / 整组拖到收藏夹空白：新建文件夹。 */
  | { kind: 'create-folder' }
  /** 标签拖到磁贴区：固定为常驻磁贴。 */
  | { kind: 'pin-tab' }
  /** 持久化磁贴拖回临时区：取消固定。 */
  | { kind: 'unpin-pin'; pinId: string }
  /** 浏览器置顶标签的磁贴拖回临时区：取消浏览器固定。 */
  | { kind: 'unpin-tab'; tabId: number }
  /** 分组头排序。 */
  | { kind: 'reorder-sections' }
  /** 同一文件夹内条目排序。 */
  | { kind: 'reorder-folder-items' }
  /** 条目跨文件夹移动。 */
  | { kind: 'move-folder-item'; targetFolderId: string }
  /** 条目拖到临时区：移出收藏夹、标签回到临时区。 */
  | { kind: 'remove-folder-item' }
  /** 文件夹之间排序。 */
  | { kind: 'reorder-folders' }
  /** 持久化磁贴之间排序。 */
  | { kind: 'reorder-pins' };

/** 拒绝原因：必须能落到一句用户能懂的说明上（文案见 useTabDragHandlers）。 */
export type DropRejectCode =
  /** 导入事务进行中：固定空间的写入会被丢弃。 */
  | 'importing'
  /** 标签顺序双向同步关闭：排序写不回浏览器。 */
  | 'sync-off'
  /** 最近访问视图：显示顺序与 index 解耦。 */
  | 'recency'
  /** 超阈值虚拟化分区：区内排序已暂停。 */
  | 'virtualized'
  /** 持久磁贴与浏览器置顶标签混拖：两种磁贴语义不同。 */
  | 'mixed-pin'
  /** 标签拖到站点分组（无原生组）：按域名自动归类，不可手动加入。 */
  | 'tab-to-site-section'
  /** 整组拖到磁贴区：磁贴区是单标签粒度。 */
  | 'section-to-pin'
  /** 收藏夹条目拖到固定空间：语义上不成立。 */
  | 'item-to-fixed'
  /** 磁贴拖到收藏夹 / 收藏夹空白：磁贴不是标签。 */
  | 'pin-to-fixed'
  /** 文件夹拖出收藏夹：收藏夹是唯一容器，没有更外层。 */
  | 'folder-outside'
  /** 兜底：落点类型未知。 */
  | 'unsupported';

/** 投放判定结果。`noop` 是可以静默的一类：拖回原位本来就没有变化。 */
export type DropOutcome =
  | { kind: 'accept'; action: DropAction }
  | { kind: 'noop' }
  | { kind: 'reject'; code: DropRejectCode };

/** 全局闸门输入（与设置/事务状态同源）。 */
export interface DropContext {
  tabOrderSync: boolean;
  sortMode: 'browser' | 'recency';
  importing: boolean;
}

const accept = (action: DropAction): DropOutcome => ({ kind: 'accept', action });
const reject = (code: DropRejectCode): DropOutcome => ({ kind: 'reject', code });
const NOOP: DropOutcome = { kind: 'noop' };

const isFixedArea = (target: DropTargetData | undefined): boolean =>
  target?.type === FIXED_AREA_DROPPABLE;
const isPinnedStrip = (target: DropTargetData | undefined): boolean =>
  target?.type === PINNED_STRIP_DROPPABLE;

/**
 * 结构判定：只看「源类型 × 落点类型」，不看任何开关。
 *
 * 视觉层必须用这个而不是 `resolveDrop`：设置闸门会让整个界面同时变成不可投放，
 * 而「这个位置本来就不收」才是需要提前画出来的。
 */
export function classifyDrop(active: DragData, target: DropTarget): DropOutcome {
  const over = target.data;
  if (!over) return reject('unsupported');

  if (active.type === DragType.Tab) {
    if (over.type === DragType.Tab) {
      if (over.tabId === active.tabId) return NOOP;
      return accept({ kind: 'reorder-tabs' });
    }
    if (over.type === DragType.Section) {
      // 站点分组 / 语言分组是派生视图，没有 groupId 就没有「加入」这个动作。
      if (over.groupId === undefined) return reject('tab-to-site-section');
      return accept({ kind: 'join-group', groupId: over.groupId });
    }
    if (over.type === DragType.Folder || over.type === DragType.FolderItem) {
      return accept({ kind: 'move-tabs-to-folder', folderId: over.folderId });
    }
    if (over.type === DragType.Pin) return accept({ kind: 'pin-tab' });
    if (isFixedArea(over) || isPinnedStrip(over)) return accept({ kind: 'pin-tab' });
    return reject('unsupported');
  }

  if (active.type === DragType.Section) {
    if (over.type === DragType.Section) {
      if (over.sectionKey === active.sectionKey) return NOOP;
      return accept({ kind: 'reorder-sections' });
    }
    if (over.type === DragType.Folder || over.type === DragType.FolderItem) {
      return accept({ kind: 'move-tabs-to-folder', folderId: over.folderId });
    }
    if (isFixedArea(over)) return accept({ kind: 'create-folder' });
    // 磁贴区是「单个常用页面」的集合，整组塞进去会破坏它的粒度语义。
    // 注意：碰撞检测把分组拖拽限制在卡片层级（cardContainers），所以 Pin 本身
    // 到不了这里，真正可达的是整条 `pinned-strip`。
    if (over.type === DragType.Pin || isPinnedStrip(over)) return reject('section-to-pin');
    // 标签行同理不在分组的候选集里：落到这里只可能是契约被单独调用，按兜底处理。
    return reject('unsupported');
  }

  if (active.type === DragType.FolderItem) {
    if (over.type === DragType.FolderItem) {
      if (over.itemId === active.itemId) return NOOP;
      if (over.folderId === active.folderId) return accept({ kind: 'reorder-folder-items' });
      return accept({ kind: 'move-folder-item', targetFolderId: over.folderId });
    }
    if (over.type === DragType.Folder) {
      // 拖回自己所属文件夹的头部：位置本来就没变，不写盘也不提示。
      if (over.folderId === active.folderId) return NOOP;
      return accept({ kind: 'move-folder-item', targetFolderId: over.folderId });
    }
    if (over.type === DragType.Tab || over.type === DragType.Section) {
      return accept({ kind: 'remove-folder-item' });
    }
    // 条目进磁贴区需要先变成真实标签（可能未打开），不做隐式打开。
    if (over.type === DragType.Pin || isPinnedStrip(over) || isFixedArea(over)) {
      return reject('item-to-fixed');
    }
    return reject('unsupported');
  }

  if (active.type === DragType.Folder) {
    if (over.type === DragType.Folder) {
      if (over.folderId === active.folderId) return NOOP;
      return accept({ kind: 'reorder-folders' });
    }
    // 收藏夹是固定空间唯一的一层容器：再往外没有落点，往里也没有嵌套。
    return reject('folder-outside');
  }

  // Pin
  if (over.type === DragType.Pin) {
    if (active.pinId !== undefined && over.pinId !== undefined) {
      if (active.pinId === over.pinId) return NOOP;
      return accept({ kind: 'reorder-pins' });
    }
    if (active.tabId !== undefined && over.tabId !== undefined) {
      if (active.tabId === over.tabId) return NOOP;
      return accept({ kind: 'reorder-pinned-tabs' });
    }
    // 两种磁贴一个落盘、一个在浏览器标签条，互换顺序没有意义。
    return reject('mixed-pin');
  }
  if (over.type === DragType.Tab || over.type === DragType.Section) {
    if (active.pinId !== undefined) return accept({ kind: 'unpin-pin', pinId: active.pinId });
    if (active.tabId !== undefined) return accept({ kind: 'unpin-tab', tabId: active.tabId });
    return reject('unsupported');
  }
  // 拖回磁贴条空白：没有目标磁贴就没有新位置，等价于取消。
  if (isPinnedStrip(over)) return NOOP;
  return reject('pin-to-fixed');
}

/**
 * 会写固定空间（folders / pins）的动作：导入事务期间必须整体拒绝。
 *
 * 不含 `join-group` / `unpin-tab`：它们只改浏览器侧（标签组归属、固定位），
 * 不参与备份事务的串行写，拦下来没有依据。
 */
const WRITES_FIXED_SPACE: ReadonlySet<DropAction['kind']> = new Set([
  'move-tabs-to-folder',
  'create-folder',
  'pin-tab',
  'unpin-pin',
  'reorder-folder-items',
  'move-folder-item',
  'remove-folder-item',
  'reorder-folders',
  'reorder-pins'
]);

/**
 * 完整判定：结构 + 全局闸门。执行层用这个，被拒时必定带回原因。
 *
 * 闸门顺序固定，保证同一个拒绝只对应一个原因（提示不会互相覆盖）：
 * 导入事务 → 排序开关 → 视图模式 → 虚拟化。
 */
export function resolveDrop(active: DragData, target: DropTarget, ctx: DropContext): DropOutcome {
  const base = classifyDrop(active, target);
  if (base.kind !== 'accept') return base;

  if (ctx.importing && WRITES_FIXED_SPACE.has(base.action.kind)) return reject('importing');

  if (base.action.kind === 'reorder-tabs' || base.action.kind === 'reorder-sections') {
    if (!ctx.tabOrderSync) return reject('sync-off');
    if (ctx.sortMode === 'recency') return reject('recency');
  }

  if (base.action.kind === 'reorder-tabs') {
    // 虚拟化分区保留 draggable/droppable 只为「拖到固定空间」，行间落点必须忽略。
    const over = target.data;
    const overCanReorder = over?.type === DragType.Tab ? over.canReorder : true;
    if (active.type === DragType.Tab && (active.canReorder === false || overCanReorder === false)) {
      return reject('virtualized');
    }
  }

  return base;
}

/**
 * 落点反馈 class：三态一一对应判定结果，供所有 droppable 共用。
 * `noop` 不给反馈——拖回原位没有变化，画个高亮反而像「放进去会做事」。
 *
 * 入参必须是 `classifyDrop` 的结果，不要传 `resolveDrop`：设置闸门（排序开关 /
 * recency / 导入事务）是全局状态，叠进视觉会让整块界面同时变灰。落点只说
 * 「这里收不收这类东西」，全局闸门留给松手时的统一提示。
 */
export function dropFeedbackClass(isOver: boolean, outcome: DropOutcome | undefined): string {
  if (!isOver || !outcome) return '';
  if (outcome.kind === 'accept') return ' is-drop-target';
  if (outcome.kind === 'reject') return ' is-drop-rejected';
  return '';
}
