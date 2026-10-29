// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collision, CollisionDetection } from '@dnd-kit/core';
import { cleanup, render } from '@testing-library/react';
import { DragType, type DragData } from '@/ui/dnd/types';
import { buildDragOverlay, dragCollisionDetection, markJustDropped } from '@/ui/dnd/DndRoot';

/**
 * 全局拖拽落点行为规格：卡片与磁贴按层级筛选目标，行目标优先精确命中和最小区域；
 * 指针位于空白处时按当前容器选择行目标，不跨分区命中外层容器。
 */

/**
 * 拖拽载荷工厂。
 *
 * 用工厂而非手写字面量：`DragData` 各成员都有必填字段（Tab 的 `canReorder`、
 * Section 的 `sectionKey`、FolderItem 的 `title`…），逐处手写必然漏字段，
 * 而漏掉的那个字段恰好是算法要读的时候，测试就会验错对象。
 */
const dndTab = (tabId: number, containerKey: string, title = 'T', url?: string): DragData => ({
  type: DragType.Tab,
  tabId,
  containerKey,
  canReorder: true,
  title,
  url
});
const dndSection = (sectionKey: string, title = 'A'): DragData => ({
  type: DragType.Section,
  sectionKey,
  title,
  tabIds: []
});
const dndPin = (pinId: string, title = 'P', url?: string): DragData => ({
  type: DragType.Pin,
  pinId,
  title,
  url
});
const dndFolder = (folderId: string, name = 'X'): DragData => ({
  type: DragType.Folder,
  folderId,
  name
});
const dndFolderItem = (folderId: string, itemId: string, title = 'I'): DragData => ({
  type: DragType.FolderItem,
  folderId,
  itemId,
  title
});

/**
 * 构造 droppable 容器 stub。
 *
 * 容器 `data` 与拖拽 `data` 是两套类型：`fixed-area` / `pinned-strip` 这类
 * **投放目标**不属于 `DragData` 联合（它们不是可拖的东西），算法只按 `type` 字符串识别，
 * 因此这里接受宽松形状并在边界处收口。
 */
function container(
  id: string,
  data: DragData | { type: string },
  rect?: { width: number; height: number }
) {
  return { id, data: { current: data }, rect: rect ?? { width: 100, height: 20 } };
}

/** 构造一次碰撞检测的入参。 */
function args(options: {
  active: DragData;
  containers: ReturnType<typeof container>[];
  /** 指针精确命中的容器 id（模拟 pointerWithin 的结果）。 */
  withinIds?: string[];
  /** 各容器的矩形（用于中心距离计算）。 */
  rects?: Record<string, { left: number; top: number; width: number; height: number }>;
  /**
   * 指针坐标（默认 (10,10)，落在默认矩形内）。
   * 传面板外的坐标才能模拟「指针不在任何投放目标上」—— 只调 rects 而指针仍在
   * 默认位置时，pointerWithin 会命中所有容器，验的就不再是空白场景了。
   */
  pointer?: { x: number; y: number };
}): Parameters<CollisionDetection>[0] {
  const containers = options.containers.map((item) => item);
  // dnd-kit 的 args 结构庞大且带泛型，这里只提供被测函数真正读取的字段
  return {
    active: { id: 'active', data: { current: options.active } },
    droppableContainers: containers,
    // 矩形必须是 DOMRect 形状（dnd-kit 的 pointerWithin 读 top/bottom/left/right，
    // 只给 left+width 会让它判成「处处不在矩形内」——pointerWithin 分支会在测试里
    // 静默退化成空数组，所有「指针精确命中」的断言其实都在验 closestCenter 兜底）。
    droppableRects: new Map(
      containers.map((item) => {
        const rect = options.rects?.[item.id] ?? { left: 0, top: 0, width: 100, height: 20 };
        return [
          item.id,
          {
            ...rect,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height
          }
        ];
      })
    ),
    pointerCoordinates: options.pointer ?? { x: 10, y: 10 },
    collisionRect: { left: 0, top: 0, width: 100, height: 20 },
    // pointerWithin 走真实实现：用碰撞矩形与容器矩形求交
    ...({} as Record<string, never>)
  } as unknown as Parameters<CollisionDetection>[0];
}

/** 取判定结果里的容器 id 列表。 */
function ids(result: Collision[]): string[] {
  return result.map((item) => String(item.id));
}

afterEach(() => {
  cleanup();
  document.body.className = '';
  vi.restoreAllMocks();
});

describe('dragCollisionDetection：卡片层级（分组 / 文件夹）', () => {
  const cardContainers = [
    container('section-a', dndSection('a', 'A')),
    container('folder-x', dndFolder('x', 'X')),
    container('fixed-area', { type: 'fixed-area' }),
    container('pinned-strip', { type: 'pinned-strip' }),
    // 内层标签行：拖动卡片时不得参与比较
    container('tab-row-1', dndTab(1, 'a'))
  ];

  it('只与同层级容器比较，内层标签行不得截胡卡片排序', () => {
    const result = dragCollisionDetection(
      args({
        active: dndSection('a', 'A'),
        containers: cardContainers
      })
    );

    expect(ids(result)).not.toContain('tab-row-1');
    expect(
      ids(result).every((id) =>
        ['section-a', 'folder-x', 'fixed-area', 'pinned-strip'].includes(id)
      )
    ).toBe(true);
  });

  it('拖文件夹时同样只比较卡片层级', () => {
    const result = dragCollisionDetection(
      args({
        active: dndFolder('x', 'X'),
        containers: cardContainers
      })
    );

    expect(ids(result)).not.toContain('tab-row-1');
  });
});

describe('dragCollisionDetection：磁贴层级（横向）', () => {
  it('指针在磁贴区内时只在磁贴与磁贴条之间判定，忽略标签行', () => {
    const result = dragCollisionDetection(
      args({
        active: dndPin('p1'),
        containers: [
          container('pin-1', dndPin('p1', 'P')),
          container('pin-2', dndPin('p2', 'Q')),
          container('pinned-strip', { type: 'pinned-strip' }),
          container('tab-row-1', dndTab(1, 'a'))
        ]
      })
    );

    expect(ids(result)).not.toContain('tab-row-1');
    expect(ids(result).every((id) => ['pin-1', 'pin-2', 'pinned-strip'].includes(id))).toBe(true);
  });

  it('指针精确落在标签行上时回退到行层级：磁贴可拖回标签区取消固定', () => {
    // 指针命中标签行时，标签行作为磁贴取消固定的落点。
    const result = dragCollisionDetection(
      args({
        active: dndPin('p1'),
        containers: [
          container('pin-1', dndPin('p1', 'P')),
          container('pinned-strip', { type: 'pinned-strip' }),
          container('tab-row-1', dndTab(1, 'a'))
        ],
        rects: {
          'pin-1': { left: 0, top: 0, width: 300, height: 40 },
          'pinned-strip': { left: 0, top: 0, width: 300, height: 100 },
          'tab-row-1': { left: 0, top: 200, width: 300, height: 24 }
        },
        pointer: { x: 10, y: 210 }
      })
    );

    expect(ids(result)).toContain('tab-row-1');
  });

  it('指针落在面板空白处不凭空命中最近的行（避免误取消固定）', () => {
    const result = dragCollisionDetection(
      args({
        active: dndPin('p1'),
        containers: [
          container('pin-1', dndPin('p1', 'P')),
          container('pinned-strip', { type: 'pinned-strip' }),
          container('tab-row-1', dndTab(1, 'a'))
        ],
        pointer: { x: 9999, y: 9999 }
      })
    );

    expect(result).toHaveLength(0);
  });

  it('指针落在收藏夹空白时命中 fixed-area（拖磁贴到收藏夹有落点可拒绝）', () => {
    const result = dragCollisionDetection(
      args({
        active: dndPin('p1'),
        containers: [
          container('pin-1', dndPin('p1', 'P')),
          container('pinned-strip', { type: 'pinned-strip' }),
          container('fixed-area', { type: 'fixed-area' })
        ],
        rects: {
          'pin-1': { left: 0, top: 0, width: 300, height: 40 },
          'pinned-strip': { left: 0, top: 0, width: 300, height: 100 },
          'fixed-area': { left: 0, top: 200, width: 300, height: 300 }
        },
        pointer: { x: 10, y: 300 }
      })
    );

    expect(ids(result)).toEqual(['fixed-area']);
  });
});

describe('dragCollisionDetection：行层级（标签 / 固定条目）', () => {
  it('指针命中的目标按面积升序返回，保证嵌套时取最深层', () => {
    const result = dragCollisionDetection(
      args({
        active: dndTab(1, 'a'),
        containers: [
          // 外层容器面积大、内层条目面积小
          container('fixed-area', { type: 'fixed-area' }, { width: 300, height: 400 }),
          container(
            'folder-item-1',
            { type: DragType.FolderItem, folderId: 'x', itemId: 'i1' },
            {
              width: 300,
              height: 24
            }
          )
        ],
        rects: {
          'fixed-area': { left: 0, top: 0, width: 300, height: 400 },
          'folder-item-1': { left: 0, top: 0, width: 300, height: 24 }
        }
      })
    );

    // 指针同时落在两者内时应命中最深的条目，而不是外层外壳
    expect(ids(result)[0]).toBe('folder-item-1');
  });

  it('指针落在空白处时限定同级同容器，不跨分区命中', () => {
    const result = dragCollisionDetection(
      args({
        active: dndTab(1, 'section-a'),
        containers: [
          container('tab-a1', dndTab(11, 'section-a', 'A1')),
          container('tab-b1', dndTab(21, 'section-b', 'B1')),
          container('fixed-area', { type: 'fixed-area' })
        ],
        pointer: { x: 9999, y: 9999 }
      })
    );

    // 同容器优先：不得命中隔壁分区，也不得被外层 fixed-area 截胡
    expect(ids(result)).toEqual(['tab-a1']);
    expect(ids(result)).not.toContain('tab-b1');
    expect(ids(result)).not.toContain('fixed-area');
  });

  it('指针落在空白且同容器无候选时，退到全部行级目标（仍不选外层容器）', () => {
    const result = dragCollisionDetection(
      args({
        active: dndTab(1, 'empty-section'),
        containers: [
          container('tab-b1', dndTab(21, 'section-b', 'B1')),
          container('fixed-area', { type: 'fixed-area' }),
          container('pinned-strip', { type: 'pinned-strip' })
        ],
        pointer: { x: 9999, y: 9999 }
      })
    );

    expect(ids(result)).not.toContain('fixed-area');
    expect(ids(result)).not.toContain('pinned-strip');
    expect(ids(result)).toContain('tab-b1');
  });

  it('完全没有行级目标时返回空（而不是退回外层容器凭空造出投放）', () => {
    const result = dragCollisionDetection(
      args({
        active: dndTab(1, 'a'),
        containers: [
          container('fixed-area', { type: 'fixed-area' }),
          container('pinned-strip', { type: 'pinned-strip' })
        ],
        pointer: { x: 9999, y: 9999 }
      })
    );

    expect(result).toHaveLength(0);
  });

  it('未带 containerKey 的拖拽不做同容器限定（不排除任何行目标）', () => {
    const result = dragCollisionDetection(
      args({
        active: dndFolderItem('x', 'i1'),
        containers: [container('folder-item-1', dndFolderItem('x', 'i1'))]
      })
    );

    expect(ids(result)).toContain('folder-item-1');
  });
});

describe('buildDragOverlay', () => {
  it('标签 / 固定条目显示 favicon + 标题', () => {
    const { container: host } = mountOverlay(dndTab(1, 'a', '标题文本', 'https://a.com/f.ico'));

    expect(host.textContent).toContain('标题文本');
  });

  it('分组显示把手图标 + 标题', () => {
    const { container: host } = mountOverlay(dndSection('a', '站点组'));

    expect(host.textContent).toContain('站点组');
  });

  it('文件夹显示名称；磁贴只显示图标（无标题文本）', () => {
    const folderOverlay = mountOverlay(dndFolder('x', '我的收藏'));
    expect(folderOverlay.container.textContent).toContain('我的收藏');

    const pinOverlay = mountOverlay(dndPin('p1', '不该出现的标题', 'https://a.com/f.ico'));
    expect(pinOverlay.container.textContent).not.toContain('不该出现的标题');
  });

  it('覆盖层始终带 drag-overlay-chip 容器类（样式依赖该钩子）', () => {
    const { container: host } = mountOverlay(dndFolder('x', 'X'));
    expect(host.querySelector('.drag-overlay-chip')).not.toBeNull();
  });
});

/**
 * 把 buildDragOverlay 的返回值挂到临时容器上以便断言。
 *
 * 必须用 RTL 的 render 而非裸 createRoot().render()：React 18+ 的并发渲染下
 * 后者是异步的，调用返回时 DOM 还是空的（断言会拿到空字符串）。
 */
function mountOverlay(data: DragData): { container: HTMLElement } {
  const { container } = render(<>{buildDragOverlay(data)}</>);
  return { container };
}

describe('markJustDropped', () => {
  it('给 body 打上一次性标记，指针移动后自动清除', () => {
    markJustDropped();
    expect(document.body.classList.contains('dnd-just-dropped')).toBe(true);

    window.dispatchEvent(new Event('pointermove'));

    expect(document.body.classList.contains('dnd-just-dropped')).toBe(false);
  });

  it('重复调用先清理上一次的监听器（键盘拖拽不产生指针移动，否则会残留）', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    markJustDropped();
    markJustDropped();

    // 第二次标记前必须移除第一次挂的 pointermove 监听，避免监听器越积越多
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(addSpy.mock.calls.filter((call) => call[0] === 'pointermove')).toHaveLength(2);
  });
});
