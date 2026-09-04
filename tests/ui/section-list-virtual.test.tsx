// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import i18n from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import type { TemporarySection } from '@/core/site/Sections';
import { SectionList } from '@/ui/tabs/SectionList';
import { DndRoot } from '@/ui/dnd/DndRoot';
import { LOCATE_SCROLL_EVENT } from '@/ui/tabs/VirtualRowList';

/**
 * P0-1 回归规格：虚拟滚动必须在默认配置（tabOrderSync=true）下生效。
 * 历史坑：useVirtual = !reorderEnabled && length > 60，而 reorderEnabled
 * 默认恒为 true → 虚拟化永不生效，性能保护恰好在标签囤积场景（200+ 标签）失效。
 * B6 方案 A：>200 强制虚拟化并暂停分区排序，同时给出可见说明。
 */

function tabsOf(count: number): TabRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    windowId: 1,
    index,
    active: false,
    pinned: false,
    incognito: false,
    url: `https://example.com/${index + 1}`,
    pendingUrl: undefined,
    title: `Tab ${index + 1}`,
    favIconUrl: undefined,
    status: 'complete',
    discarded: false,
    muted: false,
    audible: false,
    groupId: -1,
    splitViewId: undefined,
    lastAccessed: index,
    autoDiscardable: true
  }));
}

function ungroupedSection(count: number): TemporarySection {
  return { kind: 'ungrouped', key: 'ungrouped', title: 'Ungrouped', tabs: tabsOf(count) };
}

const callbacks = {
  onActivate: vi.fn(),
  onToggleMute: vi.fn(),
  onTogglePin: vi.fn(),
  onCloseTab: vi.fn(),
  onGroupRename: vi.fn(),
  onGroupRecolor: vi.fn(),
  onGroupMove: vi.fn(),
  onToggleGroupCollapsed: vi.fn(),
  onToggleSiteCollapsed: vi.fn()
};

beforeAll(() => {
  // jsdom 无 ResizeObserver / 可靠 rAF（与 virtual-row-list.test 同款 stub）
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    cb: FrameRequestCallback
  ) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (handle: number) =>
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
});

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

function renderSectionList(count: number, reorderEnabled: boolean) {
  return render(
    <DndRoot onDragEnd={() => undefined}>
      <SectionList
        sections={[ungroupedSection(count)]}
        collapsedGroups={new Set<number>()}
        collapsedSites={new Set<string>()}
        duplicateCounts={new Map<string, number>()}
        activeTabId={undefined}
        splitPartners={new Set<number>()}
        reorderEnabled={reorderEnabled}
        callbacks={callbacks}
      />
    </DndRoot>
  );
}

/** 当前挂载的标签行数（虚拟窗口内的 li，非全量）。 */
function mountedRows(view: ReturnType<typeof render>): NodeListOf<HTMLElement> {
  return view.container.querySelectorAll<HTMLElement>('li[data-tabs-tab-id]');
}

describe('SectionList 虚拟化阈值（P0-1 回归）', () => {
  it('默认配置（排序开启）250 标签仍强制虚拟化：挂载行 < 40 且显示排序暂停提示', async () => {
    const view = renderSectionList(250, true);
    await waitFor(() => {
      expect(mountedRows(view).length).toBeGreaterThan(0);
      expect(mountedRows(view).length).toBeLessThan(40);
    });
    expect(view.container.textContent).toContain(i18n.t('tabs.largeListNotice'));
  });

  it('150 标签且排序开启：不进入虚拟化（全量挂载，拖拽排序不受影响）', async () => {
    const view = renderSectionList(150, true);
    await waitFor(() => expect(mountedRows(view)).toHaveLength(150));
    expect(view.container.textContent).not.toContain(i18n.t('tabs.largeListNotice'));
  });

  it('排序关闭 + 超过 60 标签：虚拟化但不显示排序暂停提示（用户自己的选择）', async () => {
    const view = renderSectionList(100, false);
    await waitFor(() => {
      expect(mountedRows(view).length).toBeGreaterThan(0);
      expect(mountedRows(view).length).toBeLessThan(40);
    });
    expect(view.container.textContent).not.toContain(i18n.t('tabs.largeListNotice'));
  });

  it('定位事件让虚拟列表滚到目标行：深处的目标行挂载进 DOM（⌘J 关键路径）', async () => {
    const view = renderSectionList(250, true);
    await waitFor(() => expect(mountedRows(view).length).toBeGreaterThan(0));
    // 目标在初始窗口外（初始窗口只含前 ~40 行）
    expect(view.container.querySelector('li[data-tabs-tab-id="240"]')).toBeNull();
    window.dispatchEvent(new CustomEvent<number>(LOCATE_SCROLL_EVENT, { detail: 240 }));
    await waitFor(() => {
      expect(view.container.querySelector('li[data-tabs-tab-id="240"]')).not.toBeNull();
    });
  });
});
