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
import i18n from '@/i18n';
import App from '@/entrypoints/sidepanel/App';

/**
 * 侧边栏 `App` 的渲染冒烟规格。
 *
 * 这个文件的存在理由很具体：`App.tsx` 是 1035 行、约 40 个 hook 的单组件，
 * 长期 0% 覆盖，**任何结构性改动都无法被现有测试发现**。它只做最低限度的
 * 「装配是否还连着」检查 —— 渲染不炸、关键区块出现、空态与有标签态分流正确 ——
 * 目的是让「抽 hook」这类重构有可回滚的判据，而不是替代逐功能的交互测试。
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

describe('侧边栏 App（渲染冒烟）', () => {
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
    expect(screen.getByText(i18n.t('tabs.newTab'))).toBeInTheDocument();
  });

  it('无标签但已就绪时展示空态（而不是一直停在加载骨架）', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([]);

    render(<App />);

    // 断言必须落在 EmptyTabs **独有**的元素上：`empty.title` / `empty.hint` 这两个键
    // 在 SectionList 的内部空兜底里也被使用，只看文案无法区分「空态分支生效」与
    // 「退到了 SectionList 的空兜底」—— 后者正是删掉空态分支后的表现，会形成假绿。
    expect(
      await screen.findByRole('button', { name: i18n.t('empty.openNewTab') })
    ).toBeInTheDocument();
  });

  it('数据未就绪时展示加载骨架（区分「同步中」与「真的没有标签」）', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([]);
    useDataStore.setState({ ready: false });

    const { container } = render(<App />);

    // 骨架屏不含空态文案，也不含标签行
    expect(screen.queryByText(i18n.t('empty.title'))).not.toBeInTheDocument();
    expect(container.querySelector('.app')).not.toBeNull();
  });

  it('落盘降级时展示告警横幅（role=alert，读屏可感知）', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1 })]);
    useDataStore.setState({ storageDegraded: true });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.storageDegraded'));
  });
});

/**
 * 渲染输出基线快照。
 *
 * 这是为「抽 hook / 拆分组件」这类**行为等价重构**准备的判据：结构性改动没有功能
 * 差异，却极易在 memo 依赖、条件渲染顺序、props 透传上引入细微偏差，而单靠
 * 「关键元素存在」的断言无法发现。快照比对渲染树，任何偏差都会失败。
 *
 * 若某次改动**有意**调整了渲染结果，请显式更新快照并在提交说明里写清原因，
 * 不要顺手 -u 掉。
 */
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
