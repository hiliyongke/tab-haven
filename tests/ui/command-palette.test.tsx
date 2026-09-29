// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import type { Snapshot, UndoBatch } from '@/core/schema/models';
import { CommandPalette, type PaletteActions } from '@/ui/common/CommandPalette';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import i18n from '@/i18n';

/**
 * 命令面板（⌘/Ctrl+P）。
 *
 * 它是纯键盘驱动的入口，视觉上「能看见」不代表键盘可达，因此断言集中在三类契约：
 *  1. **无障碍四件套**：combobox 角色 + `aria-controls` 指向 listbox +
 *     `aria-activedescendant` 指向当前项。缺了 listbox 上下文读屏会直接忽略
 *     activedescendant，键盘上下键移动对读屏用户完全无感知；
 *  2. **漫游与执行**：↑↓ 环绕、Enter 执行选中项并关闭；命令组在前、标签组在后；
 *  3. **过滤不影响键盘顺序**：过滤后索引仍指向「扁平顺序」中的正确一项。
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

function makeActions(): PaletteActions & { calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => (): void => {
    calls.push(name);
  };
  return {
    calls,
    onDiscardInactive: record('discard'),
    onWakeAll: record('wake'),
    onQuickRegroup: record('regroup'),
    onCleanDuplicates: record('cleanDuplicates'),
    onLocateActive: record('locate'),
    onOpenHistory: record('history'),
    onOpenSettings: record('settings'),
    onToggleAllSections: record('toggle'),
    onOpenSnapshots: record('snapshots'),
    onSaveSnapshot: record('saveSnapshot'),
    onArchiveWindow: record('archive'),
    onSaveSpace: record('saveSpace'),
    onReadLaterActive: record('readLater'),
    onOpenFolder: () => undefined,
    onSwitchTab: (id) => calls.push(`switch:${id}`)
  };
}

function renderPalette(tabs: TabRecord[] = [tab({ id: 1 }), tab({ id: 2 })]) {
  const actions = makeActions();
  const onClose = vi.fn();
  render(<CommandPalette tabs={tabs} folders={[]} actions={actions} onClose={onClose} />);
  const input = screen.getByRole('combobox');
  return { actions, onClose, input };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUndoStore.setState({ batches: [] });
  useSnapshotStore.setState({ snapshots: [], ready: false });
});

describe('CommandPalette 无障碍契约', () => {
  it('输入框是 combobox，展开态有 aria-controls 指向 listbox', () => {
    const { input } = renderPalette();

    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listId = input.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    expect(document.getElementById(listId!)).toHaveAttribute('role', 'listbox');
  });

  it('aria-activedescendant 始终指向当前选中项（读屏据此播报）', () => {
    const { input } = renderPalette();

    const first = input.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    expect(document.getElementById(first!)).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = input.getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);
    expect(document.getElementById(second!)).toHaveAttribute('aria-selected', 'true');
  });

  it('命令与标签都渲染为 option（键盘漫游顺序 = 命令在前、标签在后）', () => {
    const { input } = renderPalette();

    const options = screen.getAllByRole('option');
    // 13 条命令 + 2 个标签
    expect(options).toHaveLength(15);
    expect(options[0]).toHaveTextContent(i18n.t('discard.allInactive'));
    expect(options.at(-1)).toHaveTextContent('标签-2');
    expect(input).toBeInTheDocument();
  });
});

describe('CommandPalette 键盘漫游与执行', () => {
  it('↑ 从首项环绕到末项（循环而非停住）', () => {
    const { input } = renderPalette();

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    const active = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(active!)).toHaveTextContent('标签-2');
  });

  it('Enter 执行当前选中项并关闭面板', () => {
    const { actions, onClose, input } = renderPalette();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(actions.calls).toEqual(['discard']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('移动一次后 Enter 执行的是移动后的那一项（索引与高亮一致）', () => {
    const { actions, input } = renderPalette();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(actions.calls).toEqual(['wake']);
  });

  it('Escape 触发关闭（由模态 a11y 层统一接管，组件内不重复处理）', () => {
    const { onClose } = renderPalette();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击某一项直接执行并关闭', () => {
    const { actions, onClose } = renderPalette();

    fireEvent.click(screen.getByText(i18n.t('settings.title')));

    expect(actions.calls).toEqual(['settings']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('标签项执行的是切换到对应标签', () => {
    const { actions, input } = renderPalette();

    // 过滤到只剩目标标签后直接回车
    fireEvent.change(input, { target: { value: '标签-2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(actions.calls).toEqual(['switch:2']);
  });
});

describe('CommandPalette 过滤', () => {
  it('过滤同时作用于命令与标签，且命中后索引回到首项', () => {
    const { input } = renderPalette();

    fireEvent.change(input, { target: { value: '标签-1' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('标签-1');
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-item-tab-1');
  });

  it('无命中时不渲染任何 option，且 Enter 不执行任何命令（不越界）', () => {
    const { actions, onClose, input } = renderPalette();

    fireEvent.change(input, { target: { value: '绝不可能命中的字符串' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(actions.calls).toEqual([]);
    // Enter 分支在越界时提前返回，不关闭面板（用户可继续修改关键词）
    expect(onClose).not.toHaveBeenCalled();
  });

  it('过滤词微调后选中索引被钳制回界内（等长替换同样要钳制）', () => {
    const { input } = renderPalette([tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3 })]);

    fireEvent.change(input, { target: { value: '标签' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // 换成同样命中 3 项的另一个词：索引应回到 0 而不是停在越界值
    fireEvent.change(input, { target: { value: '标签-' } });

    expect(input.getAttribute('aria-activedescendant')).toBe('palette-item-tab-1');
  });
});

describe('CommandPalette 空查询截断', () => {
  /** 造 25 个标签（超过空查询截断上限 20）。 */
  const manyTabs = () => Array.from({ length: 25 }, (_, i) => tab({ id: i + 1 }));

  it('21+ 标签时空查询仅挂载前 20 个标签项，并出现截断提示', () => {
    renderPalette(manyTabs());

    // 13 条命令 + 20 个标签（截断），第 21 个起不挂载
    expect(screen.getAllByRole('option')).toHaveLength(33);
    expect(screen.queryByText('标签-21')).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t('palette.tabsTruncated', { count: 20 }))).toBeInTheDocument();
  });

  it('截断提示不是 option，键盘漫游的末项是截断边界的标签', () => {
    const { input } = renderPalette(manyTabs());

    const hint = screen.getByText(i18n.t('palette.tabsTruncated', { count: 20 }));
    expect(hint).not.toHaveAttribute('role', 'option');
    // ↑ 环绕到末项：必须是截断边界的第 20 个标签，而非提示行
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const active = document.getElementById(input.getAttribute('aria-activedescendant')!);
    expect(active).toHaveAttribute('role', 'option');
    expect(active).toHaveTextContent('标签-20');
  });

  it('输入关键词后截断提示消失，原本被截掉的匹配项可达', () => {
    const { input } = renderPalette(manyTabs());

    fireEvent.change(input, { target: { value: '标签-2' } });

    expect(
      screen.queryByText(i18n.t('palette.tabsTruncated', { count: 20 }))
    ).not.toBeInTheDocument();
    // 「标签-2」命中 标签-2 / 标签-20…25（含空查询时被截掉的 21-25）
    const options = screen.getAllByRole('option');
    expect(options.some((option) => option.textContent?.includes('标签-25'))).toBe(true);
  });
});

describe('CommandPalette 拼音搜索（与 SearchBar 同内核）', () => {
  it('拼音首字母命中中文标签标题（jrrb 命中「今日热榜」）', async () => {
    const { input } = renderPalette([
      tab({ id: 1, title: '今日热榜', url: 'https://example.com/hot' })
    ]);

    fireEvent.change(input, { target: { value: 'jrrb' } });

    // 拼音词典异步加载：命中会在词典就绪后补齐，用 findBy 等待
    expect(await screen.findByText('今日热榜', undefined, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveAttribute('id', 'palette-item-tab-1');
  }, 20000); // 首次动态 import('pinyin-pro') 在沙箱内偶发 2–6s（与 search-engine 测试同口径放宽）

  it('文件夹名支持拼音首字母（gz 命中「工作」文件夹）', async () => {
    render(
      <CommandPalette
        tabs={[]}
        folders={[{ id: 'f1', name: '工作', collapsed: false, items: [] }]}
        actions={makeActions()}
        onClose={() => {}}
      />
    );
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'gz' } });

    expect(await screen.findByText('工作', undefined, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /工作/ })).toHaveAttribute(
      'id',
      'palette-item-folder-f1'
    );
  }, 20000);
});

describe('CommandPalette 空查询 dashboard', () => {
  function undoBatch(id: string, count: number): UndoBatch {
    return {
      id,
      kind: 'close',
      createdAt: count,
      entries: Array.from({ length: count }, (_, i) => ({
        url: `https://site-${id}-${i}.com/`,
        index: i,
        pinned: false,
        muted: false,
        groupId: NO_GROUP
      }))
    };
  }

  function snap(id: string, name: string, createdAt: number): Snapshot {
    return {
      id,
      name,
      origin: 'manual',
      createdAt,
      tabCount: 1,
      tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }]
    };
  }

  it('空查询展示最近关闭批次与最近快照，漫游序列在命令之后、标签之前', () => {
    useUndoStore.setState({ batches: [undoBatch('b1', 1), undoBatch('b2', 2)] });
    useSnapshotStore.setState({ snapshots: [snap('s1', '周末阅读', 100)], ready: true });
    const { input } = renderPalette();

    // 最近组标题出现（测试环境 en）
    expect(screen.getByText(i18n.t('palette.sectionRecent'))).toBeInTheDocument();
    // 批次条目：最新批次（b2，栈尾）在前
    expect(screen.getByText(/site-b2-0/)).toBeInTheDocument();
    // 快照条目
    expect(screen.getByText('周末阅读')).toBeInTheDocument();
    // 扁平顺序：文件夹(0) + 命令(13) + 最近(3) + 标签(2) = 18；最近组首项下标 13
    expect(screen.getAllByRole('option')).toHaveLength(18);
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 环绕到末项仍是标签
    const active = document.getElementById(input.getAttribute('aria-activedescendant')!);
    expect(active).toHaveAttribute('id', 'palette-item-tab-2');
  });

  it('点击最近关闭条目执行 undoBatch（栈内最新批次优先展示）', () => {
    const undoBatchFn = vi.fn();
    useUndoStore.setState({ batches: [undoBatch('b1', 1)], undoBatch: undoBatchFn });
    renderPalette();

    fireEvent.click(screen.getByText(/site-b1-0/));

    expect(undoBatchFn).toHaveBeenCalledWith('b1');
  });

  it('输入关键词后 dashboard 组消失（回到纯过滤模式）', () => {
    useUndoStore.setState({ batches: [undoBatch('b1', 1)] });
    useSnapshotStore.setState({ snapshots: [snap('s1', '周末阅读', 100)], ready: true });
    const { input } = renderPalette();

    fireEvent.change(input, { target: { value: '标签' } });

    expect(screen.queryByText(i18n.t('palette.sectionRecent'))).not.toBeInTheDocument();
    expect(screen.queryByText('周末阅读')).not.toBeInTheDocument();
  });
});
