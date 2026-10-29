// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SortableContext } from '@dnd-kit/sortable';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { translate } from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import { TabRow } from '@/ui/tabs/TabRow';
import { DndRoot } from '@/ui/dnd/DndRoot';

/**
 * TabRow 渲染行为规格（视图与导航）：
 * 标题/操作按钮渲染、激活与关闭回调、中键关闭（closeOnMiddleClick）、
 * 静音按钮仅在 audible/muted 时出现、无障碍标签齐全。
 */

function tabOf(partial: Partial<TabRecord> = {}): TabRecord {
  return {
    id: 11,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    url: 'https://example.com/page',
    pendingUrl: undefined,
    title: '示例页面',
    favIconUrl: undefined,
    status: 'complete',
    discarded: false,
    muted: false,
    audible: false,
    groupId: -1,
    splitViewId: undefined,
    lastAccessed: 1_000,
    autoDiscardable: true,
    ...partial
  };
}

function renderTabRow(tab: TabRecord, callbacks?: Partial<Parameters<typeof TabRow>[0]>) {
  const props = {
    tab,
    duplicateCount: 0,
    isActive: false,
    isSplitCompanion: false,
    onActivate: vi.fn(),
    onToggleMute: vi.fn(),
    onTogglePin: vi.fn(),
    onClose: vi.fn(),
    containerKey: 'test-section',
    ...callbacks
  };
  // TabRow 依赖全局 DndContext（useSortable）；SortableContext 提供排序上下文。
  render(
    <DndRoot onDragEnd={() => undefined}>
      <SortableContext items={[tab.id]}>
        <ul>
          <TabRow {...props} />
        </ul>
      </SortableContext>
    </DndRoot>
  );
  return props;
}

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('TabRow', () => {
  it('渲染标题与全部无障碍操作标签', () => {
    renderTabRow(tabOf());
    expect(screen.getByText('示例页面')).toBeInTheDocument();
    // 与组件同口径：固定是**动作**，用 context 与分区标题「固定标签」区分译法
    expect(
      screen.getByRole('button', { name: translate('固定到浏览器标签栏（置顶）') })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('关闭标签') })).toBeInTheDocument();
    // audible=false 且 muted=false：不渲染静音按钮
    expect(screen.queryByRole('button', { name: translate('静音') })).toBeNull();
  });

  it('点击主按钮激活标签', () => {
    const props = renderTabRow(tabOf());
    fireEvent.click(screen.getByTitle(translate('切换到：{{title}}', { title: '示例页面' })));
    expect(props.onActivate).toHaveBeenCalledWith(11);
  });

  it('点击关闭按钮触发 onClose', () => {
    const props = renderTabRow(tabOf());
    fireEvent.click(screen.getByRole('button', { name: translate('关闭标签') }));
    expect(props.onClose).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
  });

  it('中键点击关闭（closeOnMiddleClick 开启时）', () => {
    const props = renderTabRow(tabOf());
    // fireEvent 无 auxClick 快捷方法：派发原生 auxclick（React 合成事件映射 onAuxClick）
    fireEvent(
      screen.getByTitle(translate('切换到：{{title}}', { title: '示例页面' })),
      new MouseEvent('auxclick', { button: 1, bubbles: true })
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnMiddleClick 关闭时中键不关闭', () => {
    const props = renderTabRow(tabOf(), { closeOnMiddleClick: false });
    fireEvent(
      screen.getByTitle(translate('切换到：{{title}}', { title: '示例页面' })),
      new MouseEvent('auxclick', { button: 1, bubbles: true })
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('audible 时渲染静音按钮，点击触发 onToggleMute', () => {
    const props = renderTabRow(tabOf({ audible: true }));
    const mute = screen.getByRole('button', { name: translate('静音') });
    fireEvent.click(mute);
    expect(props.onToggleMute).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
  });

  it('muted 时按钮语义切换为取消静音', () => {
    renderTabRow(tabOf({ audible: true, muted: true }));
    expect(screen.getByRole('button', { name: translate('取消静音') })).toBeInTheDocument();
  });

  it('duplicateCount > 0 时展示重复角标（n×）', () => {
    renderTabRow(tabOf(), { duplicateCount: 3 });
    expect(screen.getByText('3×')).toBeInTheDocument();
  });

  it('showUrl 时展示完整网址', () => {
    renderTabRow(tabOf(), { showUrl: true });
    expect(screen.getByText('https://example.com/page')).toBeInTheDocument();
  });
});

/** 搜索命中行滚动规格：全量渲染时由 TabRow 滚动；虚拟化时由 VirtualRowList 按索引滚动，TabRow 保留高亮并关闭自身滚动。 */
describe('TabRow 搜索命中滚动开关', () => {
  it('默认：命中行自行 scrollIntoView（全量渲染分区依赖它）', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderTabRow(tabOf(), { isSearchActive: true });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('autoScrollOnSearch=false：命中行不自行滚动，只保留高亮（虚拟化分支）', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderTabRow(tabOf(), { isSearchActive: true, autoScrollOnSearch: false });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
