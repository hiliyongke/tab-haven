// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SortableContext } from '@dnd-kit/sortable';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import i18n from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import { TabRow } from '@/ui/tabs/TabRow';
import { DndRoot } from '@/ui/dnd/DndRoot';

/**
 * TabRow 渲染行为规格（FR-D1 视图与导航）：
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
    expect(screen.getByRole('button', { name: i18n.t('tabs.pin') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('tabs.closeTab') })).toBeInTheDocument();
    // audible=false 且 muted=false：不渲染静音按钮
    expect(screen.queryByRole('button', { name: i18n.t('tabs.mute') })).toBeNull();
  });

  it('点击主按钮激活标签', () => {
    const props = renderTabRow(tabOf());
    fireEvent.click(screen.getByTitle(i18n.t('tabs.switchTo', { title: '示例页面' })));
    expect(props.onActivate).toHaveBeenCalledWith(11);
  });

  it('点击关闭按钮触发 onClose', () => {
    const props = renderTabRow(tabOf());
    fireEvent.click(screen.getByRole('button', { name: i18n.t('tabs.closeTab') }));
    expect(props.onClose).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
  });

  it('中键点击关闭（closeOnMiddleClick 开启时）', () => {
    const props = renderTabRow(tabOf());
    // fireEvent 无 auxClick 快捷方法：派发原生 auxclick（React 合成事件映射 onAuxClick）
    fireEvent(
      screen.getByTitle(i18n.t('tabs.switchTo', { title: '示例页面' })),
      new MouseEvent('auxclick', { button: 1, bubbles: true })
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnMiddleClick 关闭时中键不关闭', () => {
    const props = renderTabRow(tabOf(), { closeOnMiddleClick: false });
    fireEvent(
      screen.getByTitle(i18n.t('tabs.switchTo', { title: '示例页面' })),
      new MouseEvent('auxclick', { button: 1, bubbles: true })
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('audible 时渲染静音按钮，点击触发 onToggleMute', () => {
    const props = renderTabRow(tabOf({ audible: true }));
    const mute = screen.getByRole('button', { name: i18n.t('tabs.mute') });
    fireEvent.click(mute);
    expect(props.onToggleMute).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
  });

  it('muted 时按钮语义切换为取消静音', () => {
    renderTabRow(tabOf({ audible: true, muted: true }));
    expect(screen.getByRole('button', { name: i18n.t('tabs.unmute') })).toBeInTheDocument();
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
