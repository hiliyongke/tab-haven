// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import * as tabsPlatform from '@/platform/tabs';
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

  it('搜索漫游 ↑↓ 时 live 区播报当前命中项（读屏不再只有视觉高亮）', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(tabSyncService, 'requestRefresh').mockImplementation(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1 }), tab({ id: 2 })]);

    const { container } = render(<App />);
    await screen.findByText('tab-1');

    // 漫游播报是第二个 <output>（第一个是命中数）。初始无选中，内容为空。
    const outputs = container.querySelectorAll('output');
    expect(outputs).toHaveLength(2);
    const roamOutput = outputs[1]!;
    expect(roamOutput).toHaveAttribute('aria-live', 'polite');
    expect(roamOutput.textContent).toBe('');

    // 输入触发过滤态（deferred），再按 ↓ 漫游到首项
    const searchbox = screen.getByRole('searchbox');
    fireEvent.change(searchbox, { target: { value: 'tab' } });
    await waitFor(() => expect(screen.queryByText('tab-1')).toBeInTheDocument());
    fireEvent.keyDown(searchbox, { key: 'ArrowDown' });

    // 当前选中项被播报（含序号与标题）。命中按相关度排序，首项不固定，
    // 故只断言格式（"第 N of M：标题"）与标题落在命中集合内，不锁死具体哪一项。
    await waitFor(() => expect(roamOutput.textContent).not.toBe(''));
    const announcement = roamOutput.textContent ?? '';
    expect(announcement).toMatch(/of 2/); // 共 2 个命中
    expect(announcement).toMatch(/tab-[12]/); // 标题是命中的标签之一
    expect(announcement).toBe(
      // 用实际选中的序号/标题反查译文，验证播报与列表选中态同源
      translate('第 {{index}} 项，共 {{count}} 项：{{title}}', {
        index: Number(announcement.match(/Item (\d+)/)?.[1] ?? '0'),
        count: 2,
        title: announcement.split(': ').at(-1) ?? ''
      })
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

describe('侧边栏语言探测', () => {
  it('语言探测期间标签快照更新时仍应用探测结果', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1 })]);
    useDataStore.setState({
      settings: { ...DEFAULT_SETTINGS, onboarded: true, tipSeen: true, groupMode: 'language' }
    });

    let resolveDetection: (language: string) => void = () => undefined;
    const detection = new Promise<string>((resolve) => {
      resolveDetection = resolve;
    });
    const detectLanguage = vi.spyOn(tabsPlatform, 'detectLanguage').mockReturnValue(detection);
    render(<App />);
    await waitFor(() => expect(detectLanguage).toHaveBeenCalledWith(1));

    await act(async () => {
      useTabStore.setState({ tabs: [tab({ id: 1, title: 'tab-1-updated' })] });
    });
    await act(async () => {
      resolveDetection('en');
      await detection;
    });

    await waitFor(() => {
      expect(useTabStore.getState().tabs.find((item) => item.id === 1)?.language).toBe('en');
    });
    expect(detectLanguage).toHaveBeenCalledTimes(1);
  });

  it('导航期间旧页面探测结果被丢弃并为新页面重新探测', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1, url: 'https://old.example/' })]);
    useDataStore.setState({
      settings: { ...DEFAULT_SETTINGS, onboarded: true, tipSeen: true, groupMode: 'language' }
    });

    let resolveOld: (language: string) => void = () => undefined;
    let resolveCurrent: (language: string) => void = () => undefined;
    const oldDetection = new Promise<string>((resolve) => {
      resolveOld = resolve;
    });
    const currentDetection = new Promise<string>((resolve) => {
      resolveCurrent = resolve;
    });
    const detectLanguage = vi
      .spyOn(tabsPlatform, 'detectLanguage')
      .mockReturnValueOnce(oldDetection)
      .mockReturnValueOnce(currentDetection);
    render(<App />);
    await waitFor(() => expect(detectLanguage).toHaveBeenCalledTimes(1));

    await act(async () => {
      useTabStore.setState({ tabs: [tab({ id: 1, url: 'https://current.example/' })] });
    });
    await act(async () => {
      resolveOld('fr');
      await oldDetection;
    });

    await waitFor(() => expect(detectLanguage).toHaveBeenCalledTimes(2));
    expect(useTabStore.getState().tabs.find((item) => item.id === 1)?.language).toBeUndefined();
    await act(async () => {
      resolveCurrent('en');
      await currentDetection;
    });

    await waitFor(() => {
      expect(useTabStore.getState().tabs.find((item) => item.id === 1)?.language).toBe('en');
    });
  });
});

describe('侧边栏静音反馈', () => {
  it('静音成功后显示明确回执', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1, audible: true, muted: false })]);
    const toggleMute = vi.fn().mockResolvedValue(true);
    const notify = vi.fn();
    useTabStore.setState({ toggleMute });
    useUndoStore.setState({ notify });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: translate('静音') }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(translate('已静音')));
  });

  it('平台返回 false 时不报成功，显示失败回执', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1, audible: true, muted: false })]);
    const toggleMute = vi.fn().mockResolvedValue(false);
    const notify = vi.fn();
    const notifyError = vi.fn();
    useTabStore.setState({ toggleMute });
    useUndoStore.setState({ notify, notifyError });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: translate('静音') }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(translate('操作失败，请稍后重试'))
    );
    expect(notify).not.toHaveBeenCalledWith(translate('已静音'));
  });

  it('静音抛错时不报成功，改走带诊断的失败反馈', async () => {
    vi.spyOn(tabSyncService, 'start').mockReturnValue(() => undefined);
    vi.spyOn(useDataStore.getState(), 'initialize').mockResolvedValue(undefined);
    primeStores([tab({ id: 1, audible: true, muted: false })]);
    const error = new Error('mute failed');
    const toggleMute = vi.fn().mockRejectedValue(error);
    const notify = vi.fn();
    const notifyFailure = vi.fn();
    useTabStore.setState({ toggleMute });
    useUndoStore.setState({ notify, notifyFailure });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: translate('静音') }));

    await waitFor(() =>
      expect(notifyFailure).toHaveBeenCalledWith(
        'sidepanel',
        translate('操作失败，请稍后重试'),
        error
      )
    );
    expect(notify).not.toHaveBeenCalledWith(translate('已静音'));
  });
});
