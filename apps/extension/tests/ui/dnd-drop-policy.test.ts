import { describe, expect, it } from 'vitest';
import {
  classifyDrop,
  dropFeedbackClass,
  resolveDrop,
  type DropContext,
  type DropOutcome
} from '@/ui/dnd/dropPolicy';
import {
  DragType,
  FIXED_AREA_DROPPABLE,
  PINNED_STRIP_DROPPABLE,
  type DragData,
  type DropTargetData
} from '@/ui/dnd/types';

/**
 * 拖拽投放契约（`ui/dnd/dropPolicy`）。
 *
 * 这是拖拽矩阵的**唯一**定义处：落点高亮（GroupCard / FixedArea / PinnedStrip /
 * FolderItemRow）与松手执行（useTabDragHandlers）都读同一份判定。因此这里每一条
 * 断言同时保护两件事：
 *  1. 能力边界（哪些组合支持、哪些明确不支持）；
 *  2. 反馈语义（拒绝必有原因，绝不静默；noop 才是唯一允许的静默）。
 *
 * 历史缺陷（本次修复的对象）：
 *  - 标签拖到分组头：卡片高亮，松手什么都不做；
 *  - 收藏夹条目拖回自己所属文件夹：写一次无效数据并弹「已移动到目标文件夹」；
 *  - 文件夹拖到收藏夹空白：高亮，松手无操作；
 *  - 排序开关关闭时：标签排序有提示、分组排序静默。
 */

const tab = (tabId: number, containerKey = 'ck', canReorder = true): DragData => ({
  type: DragType.Tab,
  tabId,
  containerKey,
  canReorder,
  title: `T${tabId}`
});

/** 原生组带 groupId；站点分组 / 语言分组是派生视图，没有 groupId。 */
const section = (sectionKey: string, groupId?: number): DragData => ({
  type: DragType.Section,
  sectionKey,
  groupId,
  title: sectionKey,
  tabIds: [1, 2]
});

const pin = (pinId?: string, tabId?: number): DragData => ({
  type: DragType.Pin,
  pinId,
  tabId,
  title: 'P'
});

const folder = (folderId: string): DragData => ({
  type: DragType.Folder,
  folderId,
  name: folderId
});

const folderItem = (folderId: string, itemId: string): DragData => ({
  type: DragType.FolderItem,
  folderId,
  itemId,
  title: itemId
});

/** 闸门全开的默认上下文。 */
const OK: DropContext = { tabOrderSync: true, sortMode: 'browser', importing: false };

/** 把判定结果压成可读标签，避免每条断言都写三段式。 */
const outcomeOf = (outcome: DropOutcome): string =>
  outcome.kind === 'accept'
    ? outcome.action.kind
    : outcome.kind === 'reject'
      ? outcome.code
      : 'noop';

const target = (data: DropTargetData | undefined, id: string | number = 'target') => ({
  id,
  data
});

describe('classifyDrop：标签作为拖拽源', () => {
  it('拖到另一个标签行 → 列表内排序', () => {
    expect(outcomeOf(classifyDrop(tab(1), target(tab(2))))).toBe('reorder-tabs');
  });

  it('拖到自己 → 原位，静默', () => {
    expect(outcomeOf(classifyDrop(tab(1), target(tab(1))))).toBe('noop');
  });

  it('拖到原生分组头 → 加入该组（不是「无操作」）', () => {
    const outcome = classifyDrop(tab(1), target(section('native-3', 3)));
    expect(outcome).toEqual({ kind: 'accept', action: { kind: 'join-group', groupId: 3 } });
  });

  it('拖到站点分组头 → 明确拒绝：按域名自动归类，不接受手动拖入', () => {
    expect(outcomeOf(classifyDrop(tab(1), target(section('site-github.com'))))).toBe(
      'tab-to-site-section'
    );
  });

  it('拖到文件夹卡或条目 → 移入收藏夹', () => {
    expect(classifyDrop(tab(1), target(folder('f1')))).toEqual({
      kind: 'accept',
      action: { kind: 'move-tabs-to-folder', folderId: 'f1' }
    });
    expect(classifyDrop(tab(1), target(folderItem('f1', 'i1')))).toEqual({
      kind: 'accept',
      action: { kind: 'move-tabs-to-folder', folderId: 'f1' }
    });
  });

  it('拖到磁贴、磁贴条、收藏夹空白 → 固定标签', () => {
    expect(outcomeOf(classifyDrop(tab(1), target(pin('p1'))))).toBe('pin-tab');
    expect(
      outcomeOf(
        classifyDrop(tab(1), target({ type: PINNED_STRIP_DROPPABLE }, PINNED_STRIP_DROPPABLE))
      )
    ).toBe('pin-tab');
    expect(
      outcomeOf(classifyDrop(tab(1), target({ type: FIXED_AREA_DROPPABLE }, FIXED_AREA_DROPPABLE)))
    ).toBe('pin-tab');
  });
});

describe('classifyDrop：分组作为拖拽源', () => {
  it('拖到另一个分组头 → 整组排序', () => {
    expect(outcomeOf(classifyDrop(section('a', 1), target(section('b', 2))))).toBe(
      'reorder-sections'
    );
  });

  it('拖到自己 → 原位，静默', () => {
    expect(outcomeOf(classifyDrop(section('a', 1), target(section('a', 1))))).toBe('noop');
  });

  it('拖到收藏夹 → 整组移入', () => {
    expect(classifyDrop(section('a', 1), target(folder('f1')))).toEqual({
      kind: 'accept',
      action: { kind: 'move-tabs-to-folder', folderId: 'f1' }
    });
  });

  it('拖到收藏夹空白 → 整组建文件夹', () => {
    expect(outcomeOf(classifyDrop(section('a', 1), target({ type: FIXED_AREA_DROPPABLE })))).toBe(
      'create-folder'
    );
  });

  it('拖到磁贴区 → 明确拒绝：磁贴区是单标签粒度', () => {
    expect(outcomeOf(classifyDrop(section('a', 1), target(pin('p1'))))).toBe('section-to-pin');
    expect(outcomeOf(classifyDrop(section('a', 1), target({ type: PINNED_STRIP_DROPPABLE })))).toBe(
      'section-to-pin'
    );
  });

  it('拖到标签行 → 走兜底拒绝（碰撞层把分组限制在卡片层级，行不会成为落点）', () => {
    expect(outcomeOf(classifyDrop(section('a', 1), target(tab(9))))).toBe('unsupported');
  });
});

describe('classifyDrop：收藏夹条目作为拖拽源', () => {
  it('同文件夹内互拖 → 条目排序', () => {
    expect(outcomeOf(classifyDrop(folderItem('f1', 'i1'), target(folderItem('f1', 'i2'))))).toBe(
      'reorder-folder-items'
    );
  });

  it('拖到另一文件夹的条目 → 跨文件夹移动', () => {
    expect(classifyDrop(folderItem('f1', 'i1'), target(folderItem('f2', 'i2')))).toEqual({
      kind: 'accept',
      action: { kind: 'move-folder-item', targetFolderId: 'f2' }
    });
  });

  it('拖到自己所属文件夹的头 → 原位（不写盘、不弹「已移动」）', () => {
    expect(outcomeOf(classifyDrop(folderItem('f1', 'i1'), target(folder('f1'))))).toBe('noop');
  });

  it('拖到另一文件夹的头 → 移动到该文件夹', () => {
    expect(classifyDrop(folderItem('f1', 'i1'), target(folder('f2')))).toEqual({
      kind: 'accept',
      action: { kind: 'move-folder-item', targetFolderId: 'f2' }
    });
  });

  it('拖回临时区 → 移出收藏夹', () => {
    expect(outcomeOf(classifyDrop(folderItem('f1', 'i1'), target(tab(1))))).toBe(
      'remove-folder-item'
    );
    expect(outcomeOf(classifyDrop(folderItem('f1', 'i1'), target(section('a', 1))))).toBe(
      'remove-folder-item'
    );
  });

  it('拖到固定空间 → 明确拒绝（条目需先成为真实标签）', () => {
    expect(outcomeOf(classifyDrop(folderItem('f1', 'i1'), target(pin('p1'))))).toBe(
      'item-to-fixed'
    );
    expect(
      outcomeOf(classifyDrop(folderItem('f1', 'i1'), target({ type: FIXED_AREA_DROPPABLE })))
    ).toBe('item-to-fixed');
  });
});

describe('classifyDrop：文件夹与磁贴作为拖拽源', () => {
  it('文件夹之间 → 排序', () => {
    expect(outcomeOf(classifyDrop(folder('f1'), target(folder('f2'))))).toBe('reorder-folders');
  });

  it('文件夹拖到自己 → 原位', () => {
    expect(outcomeOf(classifyDrop(folder('f1'), target(folder('f1'))))).toBe('noop');
  });

  it('文件夹拖出收藏夹 → 明确拒绝', () => {
    expect(outcomeOf(classifyDrop(folder('f1'), target(tab(1))))).toBe('folder-outside');
    expect(outcomeOf(classifyDrop(folder('f1'), target({ type: FIXED_AREA_DROPPABLE })))).toBe(
      'folder-outside'
    );
  });

  it('持久磁贴之间 → 磁贴排序', () => {
    expect(outcomeOf(classifyDrop(pin('p1'), target(pin('p2'))))).toBe('reorder-pins');
  });

  it('浏览器置顶标签的磁贴之间 → 走标签排序', () => {
    expect(outcomeOf(classifyDrop(pin(undefined, 1), target(pin(undefined, 2))))).toBe(
      'reorder-pinned-tabs'
    );
  });

  it('两种磁贴混拖 → 明确拒绝（语义不同，互换顺序无意义）', () => {
    expect(outcomeOf(classifyDrop(pin('p1'), target(pin(undefined, 2))))).toBe('mixed-pin');
    expect(outcomeOf(classifyDrop(pin(undefined, 1), target(pin('p2'))))).toBe('mixed-pin');
  });

  it('磁贴拖回临时区 → 取消固定（与条目可拖出对称）', () => {
    expect(classifyDrop(pin('p1'), target(tab(1)))).toEqual({
      kind: 'accept',
      action: { kind: 'unpin-pin', pinId: 'p1' }
    });
    expect(classifyDrop(pin(undefined, 7), target(tab(1)))).toEqual({
      kind: 'accept',
      action: { kind: 'unpin-tab', tabId: 7 }
    });
  });

  it('磁贴拖到收藏夹 → 明确拒绝', () => {
    expect(outcomeOf(classifyDrop(pin('p1'), target(folder('f1'))))).toBe('pin-to-fixed');
    expect(outcomeOf(classifyDrop(pin('p1'), target({ type: FIXED_AREA_DROPPABLE })))).toBe(
      'pin-to-fixed'
    );
  });
});

describe('resolveDrop：全局闸门', () => {
  it('排序开关关闭：标签排序与分组排序都给出同一原因（不再一半有提示一半静默）', () => {
    const ctx = { ...OK, tabOrderSync: false };
    expect(outcomeOf(resolveDrop(tab(1), target(tab(2)), ctx))).toBe('sync-off');
    expect(outcomeOf(resolveDrop(section('a', 1), target(section('b', 2)), ctx))).toBe('sync-off');
  });

  it('最近访问视图：排序被拦，提示切回浏览器顺序', () => {
    const ctx: DropContext = { ...OK, sortMode: 'recency' };
    expect(outcomeOf(resolveDrop(tab(1), target(tab(2)), ctx))).toBe('recency');
    expect(outcomeOf(resolveDrop(section('a', 1), target(section('b', 2)), ctx))).toBe('recency');
  });

  it('排序闸门只作用于排序，不影响拖入收藏夹', () => {
    const ctx: DropContext = { ...OK, tabOrderSync: false, sortMode: 'recency' };
    expect(outcomeOf(resolveDrop(tab(1), target(folder('f1')), ctx))).toBe('move-tabs-to-folder');
  });

  it('虚拟化分区：行间排序被拦', () => {
    expect(outcomeOf(resolveDrop(tab(1, 'ck', false), target(tab(2)), OK))).toBe('virtualized');
    expect(outcomeOf(resolveDrop(tab(1), target(tab(2, 'ck', false)), OK))).toBe('virtualized');
  });

  it('虚拟化分区仍可拖到固定空间（保留 draggable/droppable 的意义）', () => {
    expect(outcomeOf(resolveDrop(tab(1, 'ck', false), target(pin('p1')), OK))).toBe('pin-tab');
  });

  it('导入事务进行中：拒绝一切写固定空间的动作', () => {
    const ctx: DropContext = { ...OK, importing: true };
    expect(outcomeOf(resolveDrop(tab(1), target(folder('f1')), ctx))).toBe('importing');
    expect(outcomeOf(resolveDrop(tab(1), target(pin('p1')), ctx))).toBe('importing');
    expect(outcomeOf(resolveDrop(pin('p1'), target(tab(1)), ctx))).toBe('importing');
  });

  it('导入事务进行中：不写固定空间的排序照常', () => {
    const ctx: DropContext = { ...OK, importing: true };
    expect(outcomeOf(resolveDrop(tab(1), target(tab(2)), ctx))).toBe('reorder-tabs');
    expect(outcomeOf(resolveDrop(tab(1), target(section('a', 3)), ctx))).toBe('join-group');
  });

  it('拒绝优先于结构判定之后执行：不支持的组合即使闸门全开也只报结构原因', () => {
    const ctx: DropContext = { ...OK, tabOrderSync: false };
    expect(outcomeOf(resolveDrop(folder('f1'), target(tab(1)), ctx))).toBe('folder-outside');
  });
});

describe('穷尽矩阵：任意源 × 任意落点 × 任意闸门', () => {
  /** 覆盖五种源类型的所有变体（含 has groupId / has pinId / has tabId / canReorder 两种）。 */
  const sources: DragData[] = [
    tab(1, 'ck-a'),
    tab(2, 'ck-a', false),
    section('sec-native', 3),
    section('sec-site'),
    folder('f1'),
    folderItem('f1', 'i1'),
    pin('p1'),
    pin(undefined, 9)
  ];

  /** 覆盖七种落点形态（含自投放与跨容器）。 */
  const targets: DropTargetData[] = [
    tab(11, 'ck-a'),
    tab(12, 'ck-a', false),
    section('sec-native', 3),
    section('sec-site'),
    folder('f1'),
    folder('f2'),
    folderItem('f1', 'i1'),
    // 同文件夹的另一个条目：缺它就没有「同夹排序」这条路径（矩阵自身也要完整）。
    folderItem('f1', 'i2'),
    folderItem('f2', 'i2'),
    pin('p1'),
    pin('p2'),
    pin(undefined, 9),
    // 另一个浏览器置顶磁贴：缺它就没有「置顶标签排序」这条路径。
    pin(undefined, 10),
    { type: FIXED_AREA_DROPPABLE },
    { type: PINNED_STRIP_DROPPABLE }
  ];

  const contexts: DropContext[] = [
    OK,
    { tabOrderSync: false, sortMode: 'browser', importing: false },
    { tabOrderSync: true, sortMode: 'recency', importing: false },
    { tabOrderSync: true, sortMode: 'browser', importing: true }
  ];

  const allOutcomes = () => {
    const list: DropOutcome[] = [];
    for (const source of sources) {
      for (const target of targets) {
        for (const ctx of contexts) {
          list.push(resolveDrop(source, { id: 'x', data: target }, ctx));
        }
      }
    }
    return list;
  };

  it('所有组合都有合法结果：拒绝必带原因，接受必带动作，不存在未定义行为', () => {
    for (const outcome of allOutcomes()) {
      expect(['accept', 'noop', 'reject']).toContain(outcome.kind);
      if (outcome.kind === 'reject') expect(outcome.code).toBeTruthy();
      if (outcome.kind === 'accept') expect(outcome.action.kind).toBeTruthy();
    }
  });

  it('每个动作都至少有一个可达组合（不存在「定义了却永远执行不到」的分支）', () => {
    const produced = new Set<string>();
    for (const outcome of allOutcomes()) {
      if (outcome.kind === 'accept') produced.add(outcome.action.kind);
    }

    expect([...produced].sort()).toEqual(
      [
        'create-folder',
        'join-group',
        'move-folder-item',
        'move-tabs-to-folder',
        'pin-tab',
        'remove-folder-item',
        'reorder-folder-items',
        'reorder-folders',
        'reorder-pinned-tabs',
        'reorder-pins',
        'reorder-sections',
        'reorder-tabs',
        'unpin-pin',
        'unpin-tab'
      ].sort()
    );
  });

  it('每个拒绝原因都至少有一个可达组合（不存在永远触发不了的提示）', () => {
    const produced = new Set<string>();
    for (const outcome of allOutcomes()) {
      if (outcome.kind === 'reject') produced.add(outcome.code);
    }

    expect([...produced].sort()).toEqual(
      [
        'folder-outside',
        'importing',
        'item-to-fixed',
        'mixed-pin',
        'pin-to-fixed',
        'recency',
        'section-to-pin',
        'sync-off',
        'tab-to-site-section',
        'unsupported',
        'virtualized'
      ].sort()
    );
  });
});

describe('dropFeedbackClass：落点视觉三态', () => {
  const accept = classifyDrop(tab(1), target(tab(2)));
  const reject = classifyDrop(tab(1), target(section('site-a')));
  const noop = classifyDrop(tab(1), target(tab(1)));

  it('可投放 → 高亮', () => {
    expect(dropFeedbackClass(true, accept)).toBe(' is-drop-target');
  });

  it('不可投放 → 禁用态（事前告知，而不是松手后无声失败）', () => {
    expect(dropFeedbackClass(true, reject)).toBe(' is-drop-rejected');
  });

  it('原位 → 不给任何反馈（画高亮会让人以为放进去会做事）', () => {
    expect(dropFeedbackClass(true, noop)).toBe('');
  });

  it('指针不在落点上 → 无反馈', () => {
    expect(dropFeedbackClass(false, accept)).toBe('');
    expect(dropFeedbackClass(false, reject)).toBe('');
  });
});
