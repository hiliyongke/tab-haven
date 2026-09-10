// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import i18n from '@/i18n';
import App from '@/entrypoints/popup/App';

/**
 * 弹窗快速切换器（降级形态）渲染冒烟。
 *
 * 该入口此前 0% 覆盖。它与侧边栏共用 core / stores，但**自己实现了一遍搜索与键盘
 * 选择**（未复用 useSearchController），所以侧边栏的测试覆盖不到它 —— 任何一边改坏
 * 都不会被另一边的测试发现。
 *
 * 交互模型是**输入即搜（type-to-search）**而非「打开即列出全部标签」：空查询时
 * `SearchEngine.search('')` 按设计返回空数组，界面展示 `search.typeHint` 引导输入。
 * 因此断言必须区分「未输入」与「输入但无命中」两种空态 —— 它们文案不同、语义不同。
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

function primeStores(tabs: TabRecord[]): void {
  useTabStore.setState({
    tabs,
    groups: [],
    currentWindowId: 1,
    tabSyncReady: true,
    highlightedIds: new Set<number>()
  });
  useDataStore.setState({
    settings: { ...DEFAULT_SETTINGS, onboarded: true },
    folders: [],
    pins: [],
    collapsedSites: [],
    boundTabIds: [],
    ready: true,
    storageDegraded: false
  });
}

function renderPopup(tabs: TabRecord[] = [tab({ id: 1 }), tab({ id: 2 })]) {
  vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
  vi.spyOn(tabSyncService, 'requestRefresh').mockImplementation(() => undefined);
  vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
  primeStores(tabs);
  render(<App />);
  // 输入框显式声明 role="combobox"（覆盖 type=search 的隐式 searchbox 角色）
  return screen.getByRole('combobox');
}

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('弹窗快速切换器（渲染冒烟）', () => {
  it('打开时聚焦搜索框并给出输入引导（而非空白弹窗）', () => {
    const input = renderPopup();

    expect(input).toHaveFocus();
    expect(screen.getByText(i18n.t('search.typeHint'))).toBeInTheDocument();
    // 未输入时不渲染任何可选项（type-to-search 语义）
    expect(screen.queryAllByRole('button', { name: /标签-/ })).toHaveLength(0);
  });

  it('输入即过滤并渲染可点击的命中项', () => {
    const input = renderPopup();

    fireEvent.change(input, { target: { value: '标签-2' } });

    // 用「无障碍名」而非 getByText：命中分段高亮会把标题拆进多个 <b>/<span>，
    // getByText 查不到完整字符串（role 查询会拼接全部后代文本）
    expect(screen.getByRole('button', { name: /标签-2/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /标签-1/ })).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t('search.typeHint'))).not.toBeInTheDocument();
  });

  it('有输入但无命中时展示「无结果」，与「未输入」的引导文案区分开', () => {
    const input = renderPopup();

    fireEvent.change(input, { target: { value: '绝不可能命中' } });

    expect(screen.getByText(i18n.t('search.noResults'))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('search.typeHint'))).not.toBeInTheDocument();
  });

  it('aria-expanded / aria-activedescendant 随命中数正确切换（读屏可达）', () => {
    const input = renderPopup();

    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.change(input, { target: { value: '标签' } });

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe('popup-hit-0');
  });

  it('↑↓ 环绕切换选中项，Enter 激活选中标签', () => {
    const input = renderPopup();
    const activate = vi.spyOn(useTabStore.getState(), 'activateTab').mockResolvedValue(undefined);
    // window.close 在 jsdom 中不可用，激活链路末尾会调用它
    vi.spyOn(window, 'close').mockImplementation(() => undefined);

    fireEvent.change(input, { target: { value: '标签' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe('popup-hit-1');

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(activate).toHaveBeenCalledWith(2);
  });

  it('无命中时 Enter 不做任何事（不误激活）', () => {
    const input = renderPopup();
    const activate = vi.spyOn(useTabStore.getState(), 'activateTab').mockResolvedValue(undefined);

    fireEvent.change(input, { target: { value: '绝不可能命中' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(activate).not.toHaveBeenCalled();
  });

  it('设置页入口存在（弹窗里唯一能到达 options 的路径）', () => {
    renderPopup();

    expect(screen.getByLabelText(i18n.t('settings.title'))).toBeInTheDocument();
  });

  it('渲染树与基线一致（供后续等价重构比对）', () => {
    const input = renderPopup([tab({ id: 1 }), tab({ id: 2, active: true })]);
    fireEvent.change(input, { target: { value: '标签' } });

    expect(document.body.innerHTML).toMatchSnapshot();
  });
});
