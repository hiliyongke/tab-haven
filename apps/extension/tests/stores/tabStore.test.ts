import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';

/**
 * 标签 store 行为规格：重排后按顺序更新标签并连续分配 index；同步时丢弃较旧快照，
 * 对相同内容保持状态不变，并将首次成功的空快照标记为就绪。
 */

/** 使用平台层与同步服务桩，验证 store 的参数透传和返回值。 */
const mocks = vi.hoisted(() => ({
  activateTab: vi.fn<(id: number) => Promise<void>>(async () => undefined),
  closeTabs: vi.fn<(ids: readonly number[]) => Promise<number[]>>(async () => []),
  createNewTab: vi.fn<() => Promise<{ id: number }>>(async () => ({ id: 1 })),
  discardTab: vi.fn<(id: number) => Promise<boolean>>(async () => true),
  duplicateTab: vi.fn<(id: number) => Promise<boolean>>(async () => true),
  moveGroup: vi.fn<(id: number, index: number) => Promise<boolean>>(async () => true),
  recolorGroup: vi.fn<(id: number, color: string) => Promise<void>>(async () => undefined),
  renameGroup: vi.fn<(id: number, title: string) => Promise<void>>(async () => undefined),
  setGroupCollapsed: vi.fn<(id: number, collapsed: boolean) => Promise<void>>(
    async () => undefined
  ),
  toggleMute: vi.fn<(id: number, muted: boolean) => Promise<void>>(async () => undefined),
  togglePinned: vi.fn<(id: number, pinned: boolean) => Promise<boolean>>(async () => true),
  grantReuseAllowance: vi.fn<(windowId: number, key: string) => Promise<void>>(
    async () => undefined
  ),
  startSync: vi.fn()
}));

vi.mock('@/platform/tabs', () => ({
  activateTab: mocks.activateTab,
  closeTabs: mocks.closeTabs,
  createNewTab: mocks.createNewTab,
  discardTab: mocks.discardTab,
  duplicateTab: mocks.duplicateTab,
  moveGroup: mocks.moveGroup,
  recolorGroup: mocks.recolorGroup,
  renameGroup: mocks.renameGroup,
  setGroupCollapsed: mocks.setGroupCollapsed,
  toggleMute: mocks.toggleMute,
  togglePinned: mocks.togglePinned
}));

vi.mock('@/platform/sync/TabSyncService', () => ({
  tabSyncService: { start: mocks.startSync }
}));

vi.mock('@/platform/reuse/reuseAllowance', () => ({
  grantReuseAllowance: mocks.grantReuseAllowance
}));

// 导入 store 时使用上面的平台层桩。
const { useTabStore } = await import('@/stores/tabStore');

function tab(partial: Partial<TabRecord> & { id: number }): TabRecord {
  return {
    windowId: 1,
    index: partial.id,
    active: false,
    pinned: false,
    incognito: false,
    groupId: NO_GROUP,
    title: `标签-${partial.id}`,
    url: `https://site${partial.id}.com/`,
    ...partial
  };
}

function group(partial: Partial<TabGroupRecord> & { id: number }): TabGroupRecord {
  return { title: `组-${partial.id}`, color: 'blue', collapsed: false, ...partial };
}

/** 由 startTabSync 注册的快照回调，由测试用例提供同步结果。 */
interface Snapshot {
  generation: number;
  windowId: number;
  tabs: TabRecord[];
  groups: TabGroupRecord[];
}
let emitSnapshot: ((snapshot: Snapshot) => void) | undefined;

function primeStore(tabs: TabRecord[] = [], groups: TabGroupRecord[] = []): void {
  useTabStore.setState({
    tabs,
    groups,
    currentWindowId: 1,
    tabSyncReady: true,
    highlightedIds: new Set<number>()
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startSync.mockImplementation((callback: (snapshot: Snapshot) => void) => {
    emitSnapshot = callback;
    return () => undefined;
  });
  useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
  primeStore();
});

afterEach(() => {
  emitSnapshot = undefined;
});

describe('平台调用透传', () => {
  it('activateTab / closeTabs / discardTab 直接转调平台层并原样返回结果', async () => {
    mocks.closeTabs.mockResolvedValueOnce([1, 3]);

    await useTabStore.getState().activateTab(7);
    await expect(useTabStore.getState().closeTabs([1, 2, 3])).resolves.toEqual([1, 3]);
    await expect(useTabStore.getState().discardTab(9)).resolves.toBe(true);

    expect(mocks.activateTab).toHaveBeenCalledWith(7);
    expect(mocks.closeTabs).toHaveBeenCalledWith([1, 2, 3]);
    expect(mocks.discardTab).toHaveBeenCalledWith(9);
  });

  it('toggleMute 把标签的静音快照转成平台层的 currentlyMuted 参数', async () => {
    await useTabStore.getState().toggleMute(tab({ id: 1, muted: true }));

    expect(mocks.toggleMute).toHaveBeenCalledWith(1, true);
  });

  it('togglePinned / setGroupCollapsed / renameGroup / recolorGroup / moveGroup 透传参数', async () => {
    await useTabStore.getState().togglePinned(tab({ id: 2, pinned: true }));
    await useTabStore.getState().setGroupCollapsed(3, true);
    await useTabStore.getState().renameGroup(3, '新名');
    await useTabStore.getState().recolorGroup(3, 'red');
    await expect(useTabStore.getState().moveGroup(3, 5)).resolves.toBe(true);

    expect(mocks.togglePinned).toHaveBeenCalledWith(2, true);
    expect(mocks.setGroupCollapsed).toHaveBeenCalledWith(3, true);
    expect(mocks.renameGroup).toHaveBeenCalledWith(3, '新名');
    expect(mocks.recolorGroup).toHaveBeenCalledWith(3, 'red');
    expect(mocks.moveGroup).toHaveBeenCalledWith(3, 5);
  });

  it('createNewTab 把设置里的新建位置与当前窗口一起传给平台层', async () => {
    useDataStore.setState({ settings: { ...DEFAULT_SETTINGS, newTabPosition: 'after-active' } });
    useTabStore.setState({ currentWindowId: 42 });

    await useTabStore.getState().createNewTab();

    expect(mocks.createNewTab).toHaveBeenCalledWith(42, 'after-active');
  });
});

describe('duplicateTab 的复用豁免', () => {
  it('可比较的源标签先申请复用豁免再复制', async () => {
    const source = tab({ id: 1, windowId: 5, url: 'https://a.com/', title: 'A' });
    primeStore([source]);

    await useTabStore.getState().duplicateTab(1);

    expect(mocks.grantReuseAllowance).toHaveBeenCalledWith(5, 'https://a.com/');
    expect(mocks.duplicateTab).toHaveBeenCalledWith(1);
  });

  it('源标签已不存在时不申请豁免，但仍执行复制（交给平台层判定）', async () => {
    primeStore([]);

    await useTabStore.getState().duplicateTab(999);

    expect(mocks.grantReuseAllowance).not.toHaveBeenCalled();
    expect(mocks.duplicateTab).toHaveBeenCalledWith(999);
  });

  it('非 web 页（无可比对 key）不申请豁免', async () => {
    primeStore([tab({ id: 1, url: 'chrome://settings' })]);

    await useTabStore.getState().duplicateTab(1);

    expect(mocks.grantReuseAllowance).not.toHaveBeenCalled();
  });
});

describe('高亮与语言回填', () => {
  it('setHighlighted 用新集合替换（不是就地增删）', () => {
    useTabStore.getState().setHighlighted([1, 2]);

    expect([...useTabStore.getState().highlightedIds].sort()).toEqual([1, 2]);

    useTabStore.getState().setHighlighted([3]);

    expect([...useTabStore.getState().highlightedIds]).toEqual([3]);
  });

  it('setLanguage 命中时更新，未命中或值未变时不写（避免无谓重渲染）', () => {
    primeStore([tab({ id: 1 }), tab({ id: 2 })]);
    const before = useTabStore.getState().tabs;

    useTabStore.getState().setLanguage(1, 'zh-CN');
    expect(useTabStore.getState().tabs[0]!.language).toBe('zh-CN');
    expect(useTabStore.getState().tabs).not.toBe(before);

    // 值未变 → 引用不变（下游 memo 不被击穿）
    const afterFirst = useTabStore.getState().tabs;
    useTabStore.getState().setLanguage(1, 'zh-CN');
    expect(useTabStore.getState().tabs).toBe(afterFirst);

    // 标签不存在 → 引用不变
    useTabStore.getState().setLanguage(999, 'en');
    expect(useTabStore.getState().tabs).toBe(afterFirst);
  });

  it('setLanguages 一次写入多条，且无变化时保持原引用', () => {
    primeStore([tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3 })]);
    const before = useTabStore.getState().tabs;

    useTabStore.getState().setLanguages([
      [1, 'zh-CN'],
      [2, 'en']
    ]);

    expect(useTabStore.getState().tabs[0]!.language).toBe('zh-CN');
    expect(useTabStore.getState().tabs[1]!.language).toBe('en');
    expect(useTabStore.getState().tabs[2]!.language).toBeUndefined();
    expect(useTabStore.getState().tabs).not.toBe(before);

    // 再次写入相同值 → 引用不变
    const afterFirst = useTabStore.getState().tabs;
    useTabStore.getState().setLanguages([[1, 'zh-CN']]);
    expect(useTabStore.getState().tabs).toBe(afterFirst);
  });
});

describe('applyReorder 乐观重排', () => {
  it('把 source 落到目标位置并重新分配连续 index（不留空洞）', () => {
    primeStore([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 }), tab({ id: 3, index: 2 })]);

    useTabStore.getState().applyReorder(1, 2);

    const result = useTabStore.getState().tabs;
    expect(result.map((item) => item.id)).toEqual([2, 3, 1]);
    // index 必须从 0 起连续，否则显示顺序（按 index 排序）会出现空洞
    expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it('重排结果与现状一致时保持全部行对象引用（不产生无意义的整表重建）', () => {
    const first = tab({ id: 1, index: 0 });
    const second = tab({ id: 2, index: 1 });
    const third = tab({ id: 3, index: 2 });
    primeStore([first, second, third]);

    // 把已在末位的标签「移动」到末位：位置不变，引用就该不变
    useTabStore.getState().applyReorder(3, 2);

    expect(useTabStore.getState().tabs).toEqual([first, second, third]);
    expect(useTabStore.getState().tabs[0]).toBe(first);
    expect(useTabStore.getState().tabs[1]).toBe(second);
    expect(useTabStore.getState().tabs[2]).toBe(third);
  });

  it('真正发生位移时，被挤动的行才换新对象（只有 index 变化才重建）', () => {
    const second = tab({ id: 2, index: 1 });
    primeStore([tab({ id: 1, index: 0 }), second, tab({ id: 3, index: 2 })]);

    // 把 id=1 移到末尾：id=2 从 index1 变 0，必须换新对象
    useTabStore.getState().applyReorder(1, 2);

    const moved = useTabStore.getState().tabs.find((item) => item.id === 2);
    expect(moved).not.toBe(second);
    expect(moved!.index).toBe(0);
  });

  it('source 不存在时不写（不破坏现有顺序）', () => {
    primeStore([tab({ id: 1, index: 0 })]);
    const before = useTabStore.getState().tabs;

    useTabStore.getState().applyReorder(999, 0);

    expect(useTabStore.getState().tabs).toBe(before);
  });

  it.each([-1, 99])('越界目标索引 %i 时不写', (targetIndex) => {
    primeStore([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 })]);
    const before = useTabStore.getState().tabs;

    useTabStore.getState().applyReorder(1, targetIndex);

    expect(useTabStore.getState().tabs).toBe(before);
  });

  it('即便输入 index 乱序也按 index 排序后插入', () => {
    primeStore([tab({ id: 3, index: 2 }), tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 })]);

    useTabStore.getState().applyReorder(3, 0);

    expect(useTabStore.getState().tabs.map((item) => item.id)).toEqual([3, 1, 2]);
  });
});

describe('applyGroupReorder 整组乐观重排', () => {
  it('把一组标签整体落到目标索引，组内相对顺序按原 index 保持', () => {
    primeStore([
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1 }),
      tab({ id: 3, index: 2 }),
      tab({ id: 4, index: 3 })
    ]);

    // 把 [1,2] 整组移到末尾
    useTabStore.getState().applyGroupReorder([1, 2], 2);

    const result = useTabStore.getState().tabs;
    expect(result.map((item) => item.id)).toEqual([3, 4, 1, 2]);
    expect(result.map((item) => item.index)).toEqual([0, 1, 2, 3]);
  });

  it('组内传入顺序不影响结果（按当前 index 排序）', () => {
    primeStore([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 }), tab({ id: 3, index: 2 })]);

    useTabStore.getState().applyGroupReorder([2, 1], 0);

    expect(useTabStore.getState().tabs.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('空组或不存在的 id 时不写', () => {
    primeStore([tab({ id: 1, index: 0 })]);
    const before = useTabStore.getState().tabs;

    useTabStore.getState().applyGroupReorder([], 0);
    expect(useTabStore.getState().tabs).toBe(before);

    useTabStore.getState().applyGroupReorder([888], 0);
    expect(useTabStore.getState().tabs).toBe(before);
  });

  it('越界目标索引时不写', () => {
    primeStore([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 })]);
    const before = useTabStore.getState().tabs;

    useTabStore.getState().applyGroupReorder([1], 99);

    expect(useTabStore.getState().tabs).toBe(before);
  });
});

describe('startTabSync 快照守卫', () => {
  function snapshot(partial: Partial<Snapshot> & { generation: number }): Snapshot {
    return { windowId: 1, tabs: [], groups: [], ...partial };
  }

  it('代数更旧的乱序快照被丢弃', () => {
    useTabStore.getState().startTabSync();
    primeStore([], []);

    emitSnapshot!(snapshot({ generation: 5, tabs: [tab({ id: 1 })] }));
    expect(useTabStore.getState().tabs).toHaveLength(1);

    // 迟到的旧快照不得把状态回退
    emitSnapshot!(snapshot({ generation: 4, tabs: [tab({ id: 99 })] }));
    expect(useTabStore.getState().tabs.map((item) => item.id)).toEqual([1]);
  });

  it('同代快照只应用一次', () => {
    useTabStore.getState().startTabSync();
    primeStore([], []);

    emitSnapshot!(snapshot({ generation: 2, tabs: [tab({ id: 1 })] }));
    const applied = useTabStore.getState().tabs;

    emitSnapshot!(snapshot({ generation: 2, tabs: [tab({ id: 2 })] }));

    expect(useTabStore.getState().tabs).toBe(applied);
  });

  it('内容与当前态一致时不写（避免每次标签事件触发顶层全量重渲染）', () => {
    const stable = tab({ id: 1, index: 0 });
    primeStore([stable], [group({ id: 1 })]);
    useTabStore.getState().startTabSync();

    const before = useTabStore.getState().tabs;
    emitSnapshot!(snapshot({ generation: 1, tabs: [stable], groups: [group({ id: 1 })] }));

    expect(useTabStore.getState().tabs).toBe(before);
  });

  it('首次成功快照即使内容为空也必须落 tabSyncReady=true（区分「未同步」与「窗口无标签」）', () => {
    // 空快照也标记同步完成，以区分尚未同步与窗口无标签。
    useTabStore.setState({ tabs: [], groups: [], tabSyncReady: false, currentWindowId: undefined });
    useTabStore.getState().startTabSync();

    emitSnapshot!(snapshot({ generation: 1, tabs: [], groups: [], windowId: 7 }));

    expect(useTabStore.getState().tabSyncReady).toBe(true);
    expect(useTabStore.getState().currentWindowId).toBe(7);
  });

  it('分组元数据变化（标题/颜色/折叠）会被应用', () => {
    primeStore([], [group({ id: 1, title: '旧', color: 'blue', collapsed: false })]);
    useTabStore.getState().startTabSync();

    emitSnapshot!(
      snapshot({
        generation: 1,
        groups: [group({ id: 1, title: '新', color: 'red', collapsed: true })]
      })
    );

    const applied = useTabStore.getState().groups[0]!;
    expect(applied.title).toBe('新');
    expect(applied.color).toBe('red');
    expect(applied.collapsed).toBe(true);
  });

  it('切换窗口（windowId 变化）即使标签内容相同也会应用', () => {
    const stable = tab({ id: 1, index: 0 });
    primeStore([stable], []);
    useTabStore.setState({ currentWindowId: 1 });
    useTabStore.getState().startTabSync();

    emitSnapshot!(snapshot({ generation: 1, tabs: [stable], groups: [], windowId: 2 }));

    expect(useTabStore.getState().currentWindowId).toBe(2);
  });

  it('返回同步服务的清理函数', () => {
    const stop = vi.fn();
    mocks.startSync.mockReturnValueOnce(stop);

    const cleanup = useTabStore.getState().startTabSync();

    expect(cleanup).toBe(stop);
  });
});
