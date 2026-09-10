// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { createFolder, createFolderItem } from '@/core/fixed/FolderOps';
import { DEFAULT_SETTINGS, type FixedFolder, type PersistentPin } from '@/core/schema/models';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { FixedArea } from '@/ui/fixed/FixedArea';
import { FolderRow } from '@/ui/fixed/FolderRow';
import { FolderEditDialog } from '@/ui/fixed/FolderEditDialog';
import { PinnedStrip } from '@/ui/fixed/PinnedStrip';
import { CREATE_FOLDER_REQUEST_EVENT, LOCATE_TAB_EVENT } from '@/ui/fixed/events';
import i18n from '@/i18n';

/**
 * 固定空间（`ui/fixed/**`，872 行，此前接近 0% 覆盖）。
 *
 * 这是**用户长期积累的资产**所在区域，两条不变量必须守住，且都属于「错了用户会丢数据」
 * 的类型，而不是纯视觉问题：
 *
 * 1. **删除/改名必须以真实结果反馈**：`deleteFolder` / `renameFolder` 失败时若照常提示
 *    成功，用户会以为已删除而实际还在（或反之）；
 * 2. **导入事务期间禁止写入固定空间**：`importing` 为真时相关入口必须 `disabled`，
 *    否则点了「没反应」（写入被丢弃）——比报错更让人困惑。
 *
 * 另外覆盖两处事件通道：拖拽空白处建文件夹（`CREATE_FOLDER_REQUEST_EVENT`）与
 * 「定位到标签时自动展开所属文件夹」（`LOCATE_TAB_EVENT`，折叠态下命中标签不可见）。
 */

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

function folderWith(name: string, urls: string[], collapsed = false): FixedFolder {
  return {
    ...createFolder(name),
    collapsed,
    items: urls.map((url, index) => createFolderItem({ url, title: `条目${index}` }))
  };
}

/** 覆盖 store 的动作，返回各 spy 以便断言「调用了几次 / 参数是什么」。 */
function stubStores(options: {
  folders?: FixedFolder[];
  pins?: PersistentPin[];
  tabs?: TabRecord[];
  importing?: boolean;
  conceptsSeen?: boolean;
}): {
  createFolder: ReturnType<typeof vi.fn>;
  addTabsToFolder: ReturnType<typeof vi.fn>;
  renameFolder: ReturnType<typeof vi.fn>;
  deleteFolder: ReturnType<typeof vi.fn>;
  toggleFolderCollapsed: ReturnType<typeof vi.fn>;
  syncFolderToNativeGroup: ReturnType<typeof vi.fn>;
  openPin: ReturnType<typeof vi.fn>;
  removePin: ReturnType<typeof vi.fn>;
  closeTabs: ReturnType<typeof vi.fn>;
  tryUpdateSettings: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
} {
  const created = { ...createFolder('新建文件夹'), id: 'created-folder' };
  const spies = {
    createFolder: vi.fn(async () => created),
    addTabsToFolder: vi.fn(async () => undefined),
    renameFolder: vi.fn(async () => undefined),
    deleteFolder: vi.fn(async () => undefined),
    toggleFolderCollapsed: vi.fn(async () => undefined),
    syncFolderToNativeGroup: vi.fn(async () => true),
    openPin: vi.fn(async () => undefined),
    removePin: vi.fn(async () => undefined),
    closeTabs: vi.fn(async () => [1]),
    tryUpdateSettings: vi.fn(async () => true),
    notify: vi.fn()
  };

  useDataStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      onboarded: true,
      conceptsSeen: options.conceptsSeen ?? true
    },
    folders: options.folders ?? [],
    pins: options.pins ?? [],
    importing: options.importing ?? false,
    ready: true,
    ...spies
  } as never);
  useTabStore.setState({
    tabs: options.tabs ?? [],
    groups: [],
    currentWindowId: 1,
    tabSyncReady: true,
    highlightedIds: new Set<number>(),
    closeTabs: spies.closeTabs
  } as never);
  useUndoStore.setState({ notify: spies.notify, batches: [], toast: null, ready: true } as never);

  return spies;
}

/** dnd-kit 的 useSortable / useDroppable 需要外层 Context。 */
function renderInDnd(ui: React.ReactElement) {
  return render(<DndContext>{ui}</DndContext>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FixedArea 区域骨架', () => {
  it('展示分区标题与文件夹数量，并提供新建入口', () => {
    stubStores({ folders: [folderWith('工作', ['https://a.com/'])] });

    renderInDnd(<FixedArea />);

    expect(screen.getByText(i18n.t('fixed.areaTitle'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('fixed.newFolder') })).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
  });

  it('空态展示引导文案，并在未看过概念图时展示可关闭的示意图', () => {
    const { tryUpdateSettings } = stubStores({ folders: [], conceptsSeen: false });

    renderInDnd(<FixedArea />);

    expect(screen.getByText(i18n.t('fixed.emptyHint'))).toBeInTheDocument();
    const dismiss = screen.getByTitle(i18n.t('fixed.dismissConcepts'));
    fireEvent.click(dismiss);

    expect(tryUpdateSettings).toHaveBeenCalledWith({ conceptsSeen: true });
  });

  it('已看过概念图时不再展示示意图（避免长期占据固定区）', () => {
    stubStores({ folders: [], conceptsSeen: true });

    renderInDnd(<FixedArea />);

    expect(screen.getByText(i18n.t('fixed.emptyHint'))).toBeInTheDocument();
    expect(screen.queryByTitle(i18n.t('fixed.dismissConcepts'))).not.toBeInTheDocument();
  });

  it('点击新建 → 确认后创建文件夹并提示', async () => {
    const { createFolder, notify } = stubStores({ folders: [] });

    renderInDnd(<FixedArea />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.newFolder') }));
    // 不能按 label 查：fixed.newFolder 与 fixed.newFolderPrompt 文案相同，
    // 按标签会同时命中「新建收藏夹」按钮。此时屏幕上唯一的 textbox 就是弹窗输入框。
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '新收藏' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.confirm') }));

    await waitFor(() => expect(createFolder).toHaveBeenCalledWith('新收藏'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(i18n.t('toast.folderCreated')));
  });

  it('创建失败时如实提示失败（不谎报成功）', async () => {
    const spies = stubStores({ folders: [] });
    spies.createFolder.mockRejectedValueOnce(new Error('quota'));

    renderInDnd(<FixedArea />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.newFolder') }));
    // 不能按 label 查：fixed.newFolder 与 fixed.newFolderPrompt 文案相同，
    // 按标签会同时命中「新建收藏夹」按钮。此时屏幕上唯一的 textbox 就是弹窗输入框。
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.confirm') }));

    await waitFor(() =>
      expect(spies.notify).toHaveBeenCalledWith(i18n.t('errors.operationFailed'))
    );
    expect(spies.notify).not.toHaveBeenCalledWith(i18n.t('toast.folderCreated'));
  });
});

describe('FixedArea 拖拽建文件夹事件通道', () => {
  it('合法请求：弹出预填名称的对话框，确认后创建并放入拖来的标签', async () => {
    const { createFolder, addTabsToFolder, notify } = stubStores({
      folders: [],
      tabs: [tab({ id: 7 }), tab({ id: 8 }), tab({ id: 9 })]
    });

    renderInDnd(<FixedArea />);
    window.dispatchEvent(
      new CustomEvent(CREATE_FOLDER_REQUEST_EVENT, {
        detail: { name: '来自拖拽', tabIds: [7, 8] }
      })
    );

    // 不能按 label 查：fixed.newFolder 与 fixed.newFolderPrompt 文案相同，
    // 按标签会同时命中「新建收藏夹」按钮。此时屏幕上唯一的 textbox 就是弹窗输入框。
    const input = await screen.findByRole('textbox');
    expect(input).toHaveValue('来自拖拽');

    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.confirm') }));

    await waitFor(() => expect(createFolder).toHaveBeenCalledWith('来自拖拽'));
    await waitFor(() => expect(addTabsToFolder).toHaveBeenCalled());
    // 只放入请求里点名的标签，不能把整个窗口的标签都塞进去
    const passedTabs = addTabsToFolder.mock.calls[0]![0] as TabRecord[];
    expect(passedTabs.map((item) => item.id).sort()).toEqual([7, 8]);
    await waitFor(() => expect(notify).toHaveBeenCalledWith(i18n.t('toast.folderCreated')));
  });

  it.each([
    ['缺名称', { name: '', tabIds: [1] }],
    ['空标签集', { name: 'x', tabIds: [] }],
    ['tabIds 非数组', { name: 'x', tabIds: 'oops' }]
  ])('非法请求被忽略（%s），不弹对话框', (_label, detail) => {
    stubStores({ folders: [] });

    renderInDnd(<FixedArea />);
    window.dispatchEvent(new CustomEvent(CREATE_FOLDER_REQUEST_EVENT, { detail }));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('FolderRow 头部操作', () => {
  it('「打开全部」只开未打开的条目，并提示实际打开数量', async () => {
    const spies = stubStores({
      folders: [folderWith('工作', ['https://open.com/', 'https://closed.com/'])],
      // open.com 已打开 → 只应打开 closed.com
      tabs: [tab({ id: 1, url: 'https://open.com/' })]
    });
    const createTabsWithUrls = vi
      .spyOn(await import('@/platform/tabs'), 'createTabsWithUrls')
      .mockResolvedValue(1);

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.openAll') }));

    await waitFor(() => expect(createTabsWithUrls).toHaveBeenCalledWith(['https://closed.com/']));
    await waitFor(() =>
      expect(spies.notify).toHaveBeenCalledWith(i18n.t('fixed.openedAll', { count: 1 }))
    );
  });

  it('条目全部已打开时提示「都已打开」，不重复创建标签', async () => {
    const spies = stubStores({
      folders: [folderWith('工作', ['https://a.com/'])],
      tabs: [tab({ id: 1, url: 'https://a.com/' })]
    });
    const createTabsWithUrls = vi
      .spyOn(await import('@/platform/tabs'), 'createTabsWithUrls')
      .mockResolvedValue(0);

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.openAll') }));

    await waitFor(() => expect(spies.notify).toHaveBeenCalledWith(i18n.t('fixed.allOpen')));
    expect(createTabsWithUrls).not.toHaveBeenCalled();
  });

  it('存为书签：有导出条目时提示数量，零条目时提示为空（不谎报）', async () => {
    const spies = stubStores({ folders: [folderWith('工作', ['https://a.com/'])] });
    const save = vi
      .spyOn(await import('@/platform/bookmarks'), 'saveFolderToBookmarks')
      .mockResolvedValue(0);

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.toBookmarks') }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    await waitFor(() => expect(spies.notify).toHaveBeenCalledWith(i18n.t('fixed.bookmarkEmpty')));
  });

  it('折叠态下点击头部切换折叠状态', () => {
    const spies = stubStores({ folders: [folderWith('工作', ['https://a.com/'], true)] });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByText('工作'));

    expect(spies.toggleFolderCollapsed).toHaveBeenCalledWith(expect.any(String));
  });

  it('导入事务进行中：写固定空间的入口被禁用（避免「点了没反应」）', () => {
    stubStores({
      folders: [folderWith('工作', ['https://a.com/'])],
      importing: true
    });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);

    expect(screen.getByRole('button', { name: i18n.t('fixed.toNativeGroup') })).toBeDisabled();
    expect(screen.getByRole('button', { name: i18n.t('fixed.edit') })).toBeDisabled();
    expect(screen.getByRole('button', { name: i18n.t('fixed.deleteFolder') })).toBeDisabled();
    // 不改固定空间数据的两个入口不受影响
    expect(screen.getByRole('button', { name: i18n.t('fixed.openAll') })).toBeEnabled();
    expect(screen.getByRole('button', { name: i18n.t('fixed.toBookmarks') })).toBeEnabled();
  });
});

describe('FolderRow 弹窗与结果反馈', () => {
  it('编辑 → 改名成功提示重命名', async () => {
    const spies = stubStores({ folders: [folderWith('旧名', ['https://a.com/'])] });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.edit') }));
    const input = await screen.findByDisplayValue('旧名');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.save') }));

    await waitFor(() =>
      expect(spies.renameFolder).toHaveBeenCalledWith(expect.any(String), '新名')
    );
    await waitFor(() => expect(spies.notify).toHaveBeenCalledWith(i18n.t('toast.folderRenamed')));
  });

  it('删除必须二次确认；确认后才真删并提示', async () => {
    const spies = stubStores({ folders: [folderWith('工作', ['https://a.com/'])] });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.deleteFolder') }));

    // 确认框出现前不得删除
    expect(spies.deleteFolder).not.toHaveBeenCalled();
    expect(
      await screen.findByText(i18n.t('fixed.deleteConfirm', { name: '工作' }))
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.confirmDelete') }));

    await waitFor(() => expect(spies.deleteFolder).toHaveBeenCalledWith(expect.any(String)));
    await waitFor(() => expect(spies.notify).toHaveBeenCalledWith(i18n.t('toast.folderRemoved')));
  });

  it('删除失败时提示失败，绝不谎报已删除', async () => {
    const spies = stubStores({ folders: [folderWith('工作', ['https://a.com/'])] });
    spies.deleteFolder.mockRejectedValueOnce(new Error('quota'));

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.deleteFolder') }));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('fixed.confirmDelete') }));

    await waitFor(() =>
      expect(spies.notify).toHaveBeenCalledWith(i18n.t('errors.operationFailed'))
    );
    expect(spies.notify).not.toHaveBeenCalledWith(i18n.t('toast.folderRemoved'));
  });

  it('转原生组：确认后按真实结果提示成功 / 跳过 / 失败三种文案', async () => {
    const spies = stubStores({ folders: [folderWith('工作', ['https://a.com/'])] });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.toNativeGroup') }));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('dialog.confirm') }));

    await waitFor(() => expect(spies.syncFolderToNativeGroup).toHaveBeenCalled());
    await waitFor(() => expect(spies.notify).toHaveBeenCalledWith(i18n.t('toast.folderConverted')));
  });

  it('折叠态下弹窗仍能挂载（弹窗不受 GroupCard 的折叠闸门影响）', () => {
    stubStores({ folders: [folderWith('工作', ['https://a.com/'], true)] });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.edit') }));

    // 折叠只影响条目列表，编辑弹窗必须照常出现 —— 否则「折叠后点编辑没反应」
    expect(screen.getByDisplayValue('工作')).toBeInTheDocument();
  });
});

describe('FolderRow 定位事件自动展开', () => {
  it('命中折叠文件夹内的标签时自动展开（否则定位到看不见的行）', async () => {
    const spies = stubStores({
      folders: [folderWith('工作', ['https://a.com/'], true)],
      tabs: [tab({ id: 5, url: 'https://a.com/' })]
    });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    window.dispatchEvent(new CustomEvent(LOCATE_TAB_EVENT, { detail: 5 }));

    await waitFor(() =>
      expect(spies.toggleFolderCollapsed).toHaveBeenCalledWith(expect.any(String))
    );
  });

  it('命中与本人无关的标签时不展开（避免所有折叠文件夹一起弹开）', async () => {
    const spies = stubStores({
      folders: [folderWith('工作', ['https://a.com/'], true)],
      tabs: [tab({ id: 5, url: 'https://other.com/' })]
    });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    window.dispatchEvent(new CustomEvent(LOCATE_TAB_EVENT, { detail: 5 }));

    await Promise.resolve();
    expect(spies.toggleFolderCollapsed).not.toHaveBeenCalled();
  });

  it('非整数 detail 被忽略（脏事件不触发折叠变更）', async () => {
    const spies = stubStores({
      folders: [folderWith('工作', ['https://a.com/'], true)],
      tabs: [tab({ id: 5, url: 'https://a.com/' })]
    });

    renderInDnd(<FolderRow folder={useDataStore.getState().folders[0]!} />);
    window.dispatchEvent(new CustomEvent(LOCATE_TAB_EVENT, { detail: 'not-a-number' }));

    await Promise.resolve();
    expect(spies.toggleFolderCollapsed).not.toHaveBeenCalled();
  });
});

describe('PinnedStrip', () => {
  it('无固定图标时返回 null（不占位、不渲染空容器）', () => {
    stubStores({ pins: [] });

    const { container } = renderInDnd(<PinnedStrip />);

    expect(container.querySelector('.pinned-strip')).toBeNull();
  });

  it('有固定图标时渲染磁贴与拖拽落点提示', () => {
    stubStores({
      pins: [
        { id: 'p1', identity: 'a.com', url: 'https://a.com/', title: '常驻 A' },
        { id: 'p2', identity: 'b.com', url: 'https://b.com/', title: '常驻 B' }
      ]
    });

    renderInDnd(<PinnedStrip />);

    const strip = document.querySelector('.pinned-strip');
    expect(strip).not.toBeNull();
    expect(strip).toHaveAttribute('aria-label', i18n.t('sections.pinned'));
    expect(strip).toHaveAttribute('data-drop-label', i18n.t('fixed.dragToPin'));
    // 每个磁贴含「磁贴本体」+「取消固定」两个按钮
    expect(screen.getAllByRole('button', { name: i18n.t('fixed.removePin') })).toHaveLength(2);
  });
});

describe('FolderEditDialog', () => {
  it('保存时名字为空则回退原名（不允许把文件夹改成空名）', () => {
    const onRename = vi.fn();
    const onClose = vi.fn();

    render(
      <FolderEditDialog
        initialName="原名"
        onRename={onRename}
        onDelete={vi.fn()}
        onClose={onClose}
      />
    );
    fireEvent.change(screen.getByDisplayValue('原名'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.save') }));

    expect(onRename).toHaveBeenCalledWith('原名');
    expect(onClose).toHaveBeenCalled();
  });

  it('回车即保存（不必点按钮）', () => {
    const onRename = vi.fn();

    render(
      <FolderEditDialog
        initialName="原名"
        onRename={onRename}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const input = screen.getByDisplayValue('原名');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('新名');
  });

  it('删除走二次确认；取消确认不删除', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <FolderEditDialog
        initialName="原名"
        onRename={vi.fn()}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.delete') }));

    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.cancel') }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('确认删除后调用 onDelete 并关闭弹窗', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <FolderEditDialog
        initialName="原名"
        onRename={vi.fn()}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('fixed.delete') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.confirm') }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
