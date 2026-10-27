// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FixedFolder } from '@/core/schema/models';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { CommandPalette, type PaletteActions } from '@/ui/panels/CommandPalette';
import { translate } from '@/i18n';

/**
 * 命令面板文件夹命令（「文件夹即空间」：一键打开整组收藏）。
 *
 * 契约集中三点：
 *  1. 每个固定文件夹渲染一个 option，分组标题在最前（文件夹 → 命令 → 标签）；
 *  2. 漫游顺序：文件夹组在前，ArrowUp 环绕从末项回到首项（文件夹命令）；
 *  3. 点击 / 过滤命中后 Enter 都执行 onOpenFolder(folderId)。
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

function folder(partial: Partial<FixedFolder> & { id: string; name: string }): FixedFolder {
  return {
    createdAt: 0,
    collapsed: false,
    items: [],
    ...partial
  } as FixedFolder;
}

function makeActions(): PaletteActions & { openedFolders: string[] } {
  const openedFolders: string[] = [];
  const noop = (): void => undefined;
  return {
    openedFolders,
    onDiscardInactive: noop,
    onWakeAll: noop,
    onQuickRegroup: noop,
    onCleanDuplicates: noop,
    onLocateActive: noop,
    onOpenHistory: noop,
    onOpenSettings: noop,
    onExportData: noop,
    onOpenAbout: noop,
    onToggleAllSections: noop,
    onOpenSnapshots: noop,
    onSaveSnapshot: noop,
    onArchiveWindow: noop,
    onSaveSpace: noop,
    onOpenFolder: (folderId) => {
      openedFolders.push(folderId);
    },
    onSaveTabToFolder: (folderId) => {
      openedFolders.push(`save:${folderId}`);
    },
    onSwitchSpace: (spaceId) => {
      openedFolders.push(`space:${spaceId}`);
    },
    onSwitchTab: () => undefined
  };
}

function renderPalette(folders: FixedFolder[], tabs: TabRecord[] = [tab({ id: 1 })]) {
  const actions = makeActions();
  const onClose = vi.fn();
  render(<CommandPalette tabs={tabs} folders={folders} actions={actions} onClose={onClose} />);
  const input = screen.getByRole('combobox');
  return { actions, onClose, input };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CommandPalette 文件夹命令', () => {
  it('每个文件夹渲染一个 option，排在命令组与标签组之前', () => {
    const folders = [
      folder({ id: 'f1', name: '项目 A', items: [] }),
      folder({ id: 'f2', name: '项目 B', items: [] })
    ];
    const { input } = renderPalette(folders);

    const options = screen.getAllByRole('option');
    // 2 文件夹 + 13 基础命令 + 2 条「存到文件夹」+ 1 标签
    expect(options).toHaveLength(19);
    expect(options[0]).toHaveTextContent('项目 A');
    expect(options[1]).toHaveTextContent('项目 B');
    expect(options[2]).toHaveTextContent(translate('休眠全部后台标签（释放内存）'));
    expect(input).toBeInTheDocument();
  });

  it('无文件夹时不渲染分组标题（不出现空组）', () => {
    renderPalette([]);
    expect(screen.queryByText(translate('打开收藏夹文件夹'))).not.toBeInTheDocument();
  });

  it('点击文件夹命令执行 onOpenFolder 并关闭', () => {
    const folders = [folder({ id: 'f1', name: '研究资料' })];
    const { actions, onClose } = renderPalette(folders);

    fireEvent.click(screen.getByText('研究资料'));

    expect(actions.openedFolders).toEqual(['f1']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('过滤命中文件夹名后 Enter 执行该文件夹命令', () => {
    const folders = [
      folder({ id: 'f1', name: '前端项目' }),
      folder({ id: 'f2', name: '后端项目' })
    ];
    const { actions, input } = renderPalette(folders);

    fireEvent.change(input, { target: { value: '后端' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(actions.openedFolders).toEqual(['f2']);
  });

  it('过滤词对文件夹名与命令名同时生效', () => {
    const folders = [folder({ id: 'f1', name: 'Settings hub' })];
    const { input } = renderPalette(folders);

    fireEvent.change(input, { target: { value: 'set' } });

    const options = screen.getAllByRole('option');
    // 文件夹「Settings hub」+ 命令「设置」+ 「把当前标签存到「Settings hub」」
    // （写入命令的 label 含文件夹名，同样命中；它排在命令组，不与「打开」争首位）
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent('Settings hub');
    expect(options[1]).toHaveTextContent(translate('设置'));
    expect(options[2]).toHaveTextContent(
      translate('把当前标签存到「{{name}}」', { name: 'Settings hub' })
    );
  });

  it('漫游顺序：ArrowUp 从末项环绕回首项（文件夹命令在前）', () => {
    const folders = [folder({ id: 'f1', name: '环绕测试' })];
    const { input } = renderPalette(folders);

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    const active = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(active!)).toHaveTextContent('标签-1');
    // 再按一次 Up：末项 → 倒数第二项（命令组最后一项：写入命令排在基础命令之后）
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const second = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(second!)).toHaveTextContent(
      translate('把当前标签存到「{{name}}」', { name: '环绕测试' })
    );
  });
});
