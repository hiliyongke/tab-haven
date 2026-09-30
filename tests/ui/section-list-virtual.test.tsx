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
 * 默认恒为 true → 该分支永不生效，性能保护恰好在标签囤积场景（200+ 标签）失效。
 * 现行分档：排序关闭 > 60 行即虚拟化；排序开启时 > 120 行强制虚拟化并暂停分区
 * 排序，同时给出可见说明（阈值从 200 下调，缩小「既不虚拟化又全量挂载」的区间）。
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
  onToggleSiteCollapsed: vi.fn(),
  onCloseSection: vi.fn()
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

/**
 * 站点聚合组（同一域名）头部提供「整批关闭」入口：逐个点关闭要 N 次，
 * 且会生成 N 条撤销批次（撤回要点 N 次）——整批一次入栈才可用。
 * 未分组分区不应出现该入口（它没有域名语义）。
 */
describe('SectionList 分区整批关闭（同一域名）', () => {
  function siteSection(count: number): TemporarySection {
    return {
      kind: 'site',
      key: 'site:example.com',
      siteKey: 'example.com',
      title: 'example.com',
      tabs: tabsOf(count)
    };
  }

  it('站点分区头部有「关闭全部」按钮，点击整批回调（一次调用而非逐条）', () => {
    const view = render(
      <DndRoot onDragEnd={() => undefined}>
        <SectionList
          sections={[siteSection(3)]}
          collapsedGroups={new Set<number>()}
          collapsedSites={new Set<string>()}
          duplicateCounts={new Map<string, number>()}
          activeTabId={undefined}
          splitPartners={new Set<number>()}
          reorderEnabled={false}
          callbacks={callbacks}
        />
      </DndRoot>
    );

    const closeAll = view.container.querySelector<HTMLElement>('button.close-site');
    expect(closeAll).not.toBeNull();
    closeAll!.click();

    expect(callbacks.onCloseSection).toHaveBeenCalledTimes(1);
    // 整批：传整个分区（3 条标签），而不是逐条 onCloseTab
    expect(callbacks.onCloseSection.mock.calls[0]![0]).toMatchObject({ kind: 'site' });
    expect((callbacks.onCloseSection.mock.calls[0]![0] as TemporarySection).tabs).toHaveLength(3);
    expect(callbacks.onCloseTab).not.toHaveBeenCalled();
  });

  it('原生组分区同样有整批关闭入口（自动分组同步为原生组的域名分组走这条路径）', () => {
    const native: TemporarySection = {
      kind: 'native',
      key: 'group-5',
      title: 'buy.cloud.tencent.com',
      tabs: tabsOf(2),
      groupId: 5,
      collapsed: false
    };
    const view = render(
      <DndRoot onDragEnd={() => undefined}>
        <SectionList
          sections={[native]}
          collapsedGroups={new Set<number>()}
          collapsedSites={new Set<string>()}
          duplicateCounts={new Map<string, number>()}
          activeTabId={undefined}
          splitPartners={new Set<number>()}
          reorderEnabled={false}
          callbacks={callbacks}
        />
      </DndRoot>
    );

    const closeAll = view.container.querySelector<HTMLElement>('button.close-site');
    expect(closeAll).not.toBeNull();
    closeAll!.click();
    expect(callbacks.onCloseSection.mock.calls[0]![0]).toMatchObject({
      kind: 'native',
      groupId: 5
    });
  });

  it('未分组分区不给「关闭全部」入口（无域名语义，避免误关全窗口）', () => {
    const view = renderSectionList(3, false);

    expect(view.container.querySelector('button.close-site')).toBeNull();
  });
});

describe('SectionList 虚拟化阈值（P0-1 回归）', () => {
  it('默认配置（排序开启）250 标签仍强制虚拟化：挂载行 < 40 且显示排序暂停提示', async () => {
    const view = renderSectionList(250, true);
    await waitFor(() => {
      expect(mountedRows(view).length).toBeGreaterThan(0);
      expect(mountedRows(view).length).toBeLessThan(40);
    });
    expect(view.container.textContent).toContain(i18n.t('tabs.largeListNotice'));
  });

  it('100 标签且排序开启：不进入虚拟化（全量挂载，拖拽排序不受影响）', async () => {
    // 排序开启时的强制阈值是 120（高于排序关闭时的 60）：排序是默认开启的高频
    // 能力，过早虚拟化会大面积剥夺它，因此让排序优先，直到行数大到必须让步。
    const view = renderSectionList(100, true);
    await waitFor(() => expect(mountedRows(view)).toHaveLength(100));
    expect(view.container.textContent).not.toContain(i18n.t('tabs.largeListNotice'));
  });

  it('150 标签且排序开启：越过强制阈值，虚拟化并提示排序已暂停', async () => {
    const view = renderSectionList(150, true);
    await waitFor(() => {
      expect(mountedRows(view).length).toBeGreaterThan(0);
      expect(mountedRows(view).length).toBeLessThan(40);
    });
    expect(view.container.textContent).toContain(i18n.t('tabs.largeListNotice'));
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
