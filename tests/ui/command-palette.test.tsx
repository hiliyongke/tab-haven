// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { CommandPalette, type PaletteActions } from '@/ui/common/CommandPalette';
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
    onSwitchTab: (id) => calls.push(`switch:${id}`)
  };
}

function renderPalette(tabs: TabRecord[] = [tab({ id: 1 }), tab({ id: 2 })]) {
  const actions = makeActions();
  const onClose = vi.fn();
  render(<CommandPalette tabs={tabs} actions={actions} onClose={onClose} />);
  const input = screen.getByRole('combobox');
  return { actions, onClose, input };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    // 12 条命令 + 2 个标签
    expect(options).toHaveLength(14);
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
