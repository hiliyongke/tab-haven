// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { translate } from '@/i18n';
import App from '@/entrypoints/sidepanel/App';

/**
 * 侧边栏 App 渲染行为规格：数据就绪时展示标签列表或空态，数据未就绪时展示加载骨架，
 * 存储降级时展示告警横幅。
 */

function tab(partial: Partial<TabRecord> & { id: number }): TabRecord {
  return {
    windowId: 1,
    index: partial.id,
    active: false,
    pinned: false,
    incognito: false,
    groupId: NO_GROUP,
    title: `tab-${partial.id}`,
    url: `https://site${partial.id}.com/`,
    ...partial
  };
}

/** 把各 store 直接置为「已就绪」状态，绕开真实的存储初始化链路。 */
function primeStores(tabs: TabRecord[] = []): void {
  useTabStore.setState({
    tabs,
    groups: [],
    currentWindowId: 1,
    tabSyncReady: true,
    highlightedIds: new Set<number>()
  });
  useDataStore.setState({
    // onboarded=true：跳过首启引导（它是覆盖全屏的 <dialog>，会挡住其余断言）
    settings: { ...DEFAULT_SETTINGS, onboarded: true, tipSeen: true },
    folders: [],
    pins: [],
    collapsedSites: [],
    boundTabIds: [],
    ready: true,
    storageDegraded: false
  });
  useUndoStore.setState({ batches: [], toast: null, ready: true, undoing: false });
  useSnapshotStore.setState({ snapshots: [], ready: true });
}

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('侧边栏 App 渲染状态', () => {
  it('数据就绪且有标签时渲染搜索框、标签列表与新建按钮', async () => {
    // 挂载时会启动同步服务并做数据初始化：这两条外部链路与本冒烟目标无关，直接打桩
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(tabSyncService, 'requestRefresh').mockImplementation(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1 }), tab({ id: 2 })]);

    render(<App />);

    expect(await screen.findByText('tab-1')).toBeInTheDocument();
    expect(screen.getByText('tab-2')).toBeInTheDocument();
    // 搜索入口与新建标签按钮是面板的两个恒定锚点
    // 注意 SearchBar 的 input 是 type="search"，无障碍角色为 searchbox（不是 textbox）
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByText(translate('新建标签'))).toBeInTheDocument();
  });

  it('无标签且数据就绪时展示空态', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([]);

    render(<App />);

    // 使用 EmptyTabs 独有的打开新标签按钮确认空态分支。
    expect(
      await screen.findByRole('button', { name: translate('打开新标签') })
    ).toBeInTheDocument();
  });

  it('数据未就绪时展示加载骨架（区分「同步中」与「真的没有标签」）', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([]);
    useDataStore.setState({ ready: false });

    const { container } = render(<App />);

    // 骨架屏不含空态文案，也不含标签行
    expect(screen.queryByText(translate('这个窗口还没有标签'))).not.toBeInTheDocument();
    expect(container.querySelector('.app')).not.toBeNull();
  });

  it('落盘降级时展示告警横幅（role=alert，读屏可感知）', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1 })]);
    useDataStore.setState({ storageDegraded: true });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      translate('最近的改动可能没能保存到本地：请检查浏览器存储空间是否已满，或扩展权限是否被收回')
    );
  });
});

/** 渲染输出快照：验证有标签、空态与存储降级横幅组合下的侧边栏渲染树。 */
describe('侧边栏 App（渲染输出基线）', () => {
  it('有标签时的渲染树与基线一致', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1 }), tab({ id: 2, active: true })]);

    const { container } = render(<App />);
    await screen.findByText('tab-1');

    expect(container.innerHTML).toMatchSnapshot();
  });

  it('空态与降级横幅并存时的渲染树与基线一致', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([]);
    useDataStore.setState({ storageDegraded: true });

    const { container } = render(<App />);
    await screen.findByRole('alert');

    expect(container.innerHTML).toMatchSnapshot();
  });
});
