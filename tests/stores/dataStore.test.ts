// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import {
  useDataStore,
  registerSnapshotProvider,
  resetSnapshotProvider
} from '@/stores/dataStore';
import { readSession } from '@/platform/storage/session';

function makeTab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

/**
 * dataStore 核心事务行为（固定空间 + 一致性协调）：
 *  - addTabsToFolder：URL 全局唯一（新增/移动/跳过 三分支 + 会话绑定建立）；
 *  - deleteFolder：清理文件夹条目的会话绑定；
 *  - importData：非法导出数据拒绝；
 *  - toggleSiteCollapsed：幂等；
 *  - reconcileWithTabs：挂起条目转正 + 绑定维护。
 */
describe('dataStore 固定空间事务', () => {
  beforeEach(() => {
    // ThemeApplier.resolveTheme 依赖 matchMedia（jsdom 缺失）
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia;
    useDataStore.setState({
      folders: [],
      pins: [],
      collapsedSites: [],
      settings: DEFAULT_SETTINGS,
      boundTabIds: [],
      storageDegraded: false,
      ready: false
    });
  });

  afterEach(() => {
    fakeBrowser.reset();
    resetSnapshotProvider();
    vi.restoreAllMocks();
  });

  it('addTabsToFolder：URL 全局唯一（新增 → 移动 → 跳过）', async () => {
    await useDataStore.getState().createFolder('F');
    const folderId = useDataStore.getState().folders[0]!.id;

    const first = await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 1, url: 'https://a.com/', title: 'A' })], folderId);
    expect(first.added).toBe(1);

    // 同 URL 再拖入同一文件夹：已在目标文件夹，不算移动（skipped），条目保持原位
    const second = await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 2, url: 'https://a.com/', title: 'A2' })], folderId);
    expect(second.added).toBe(0);
    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);

    // 全局唯一约束：文件夹内始终只有 1 条，且保持原位（不被移到末尾）
    expect(useDataStore.getState().folders[0]!.items).toHaveLength(1);
    expect(useDataStore.getState().folders[0]!.items[0]!.url).toBe('https://a.com/');
  });

  it('addTabsToFolder：非 web 页不加入（skipped）', async () => {
    await useDataStore.getState().createFolder('F');
    const folderId = useDataStore.getState().folders[0]!.id;

    const result = await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 1, url: 'chrome://newtab/' })], folderId);
    expect(result).toEqual({ added: 0, moved: 0, skipped: 1 });
    expect(useDataStore.getState().folders[0]!.items).toHaveLength(0);
  });

  it('addTabsToFolder：为新条目建立会话绑定（标签立即从临时区排除）', async () => {
    await useDataStore.getState().createFolder('F');
    const folderId = useDataStore.getState().folders[0]!.id;

    await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 7, url: 'https://a.com/', title: 'A' })], folderId);

    const itemId = useDataStore.getState().folders[0]!.items[0]!.id;
    const session = await readSession();
    expect(session.itemTabBindings[itemId]).toBe(7);
    expect(useDataStore.getState().boundTabIds).toEqual([7]);
  });

  it('deleteFolder：清理该文件夹条目的会话绑定', async () => {
    await useDataStore.getState().createFolder('F');
    const folderId = useDataStore.getState().folders[0]!.id;
    await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 7, url: 'https://a.com/' })], folderId);

    await useDataStore.getState().deleteFolder(folderId);

    expect(useDataStore.getState().folders).toHaveLength(0);
    const session = await readSession();
    expect(session.itemTabBindings).toEqual({});
    expect(useDataStore.getState().boundTabIds).toEqual([]);
  });

  it('importData：非法导出数据被拒绝', async () => {
    await expect(useDataStore.getState().importData({ format: 'bad' })).rejects.toThrow(
      'invalid-tab-haven-export'
    );
  });

  it('importData：部分分区写入失败时整体回滚（不留下半套数据）', async () => {
    const payload = {
      format: 'tabs.export',
      exportedAt: new Date().toISOString(),
      fixedFolders: [
        {
          id: 'f1',
          name: '导入的文件夹',
          collapsed: false,
          items: [{ id: 'i1', url: 'https://a.com/', title: 'A', createdAt: 1 }]
        }
      ],
      persistentPins: [],
      siteCollapse: [],
      settings: DEFAULT_SETTINGS
    };

    // 只让第二个分区（persistentPins）写失败：校验事务是否回滚已写入的 folders。
    const realSet = fakeBrowser.storage.local.set;
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockImplementation(((items: Record<string, unknown>) => {
        if ('tabs.persistent-pins.v1' in items) return Promise.reject(new Error('quota'));
        return realSet(items);
      }) as never);

    await expect(useDataStore.getState().importData(payload)).rejects.toThrow(
      'import-write-failed:pins'
    );

    // 内存态未被污染
    expect(useDataStore.getState().folders).toHaveLength(0);
    // 已写入的分区已回滚：磁盘上不应残留导入的文件夹
    const stored = (await fakeBrowser.storage.local.get('tabs.fixed-folders.v1')) as Record<
      string,
      unknown
    >;
    expect(stored['tabs.fixed-folders.v1'] ?? []).toEqual([]);
    setSpy.mockRestore();
  });

  it('exportData：导出为完整备份（含快照与归档）', async () => {
    registerSnapshotProvider(() => [
      {
        id: 's1',
        name: '归档',
        origin: 'archive',
        createdAt: 1,
        tabCount: 1,
        tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }]
      }
    ]);

    const file = useDataStore.getState().exportData();
    expect(file.format).toBe('tabs.export');
    expect(file.snapshots).toHaveLength(1);
    expect(file.snapshots[0]!.origin).toBe('archive');
  });

  it('importData：备份覆盖快照（完整备份语义）', async () => {
    await fakeBrowser.storage.local.set({
      'tabs.snapshots.v1': [
        { id: 'old', name: '旧快照', origin: 'manual', createdAt: 1, tabCount: 0, tabs: [] }
      ]
    });

    const payload = {
      format: 'tabs.export',
      exportedAt: new Date().toISOString(),
      fixedFolders: [],
      persistentPins: [],
      siteCollapse: [],
      settings: DEFAULT_SETTINGS,
      snapshots: [
        { id: 'new', name: '新快照', origin: 'manual', createdAt: 2, tabCount: 0, tabs: [] }
      ]
    };

    await useDataStore.getState().importData(payload);

    const stored = (await fakeBrowser.storage.local.get('tabs.snapshots.v1')) as Record<
      string,
      { id: string }[]
    >;
    expect(stored['tabs.snapshots.v1']).toHaveLength(1);
    expect(stored['tabs.snapshots.v1']![0]!.id).toBe('new');
  });

  it('updateSettings：落盘失败时不切换到新值并置起降级标志', async () => {
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockImplementation(() => Promise.reject(new Error('quota')) as never);

    await expect(useDataStore.getState().updateSettings({ density: 'compact' })).rejects.toThrow(
      'settings-write-failed'
    );

    expect(useDataStore.getState().settings.density).toBe('cozy');
    expect(useDataStore.getState().storageDegraded).toBe(true);
    setSpy.mockRestore();
  });

  it('toggleSiteCollapsed：幂等写入', async () => {
    await useDataStore.getState().toggleSiteCollapsed('a.com', true);
    await useDataStore.getState().toggleSiteCollapsed('a.com', true);
    expect(useDataStore.getState().collapsedSites).toEqual(['a.com']);

    await useDataStore.getState().toggleSiteCollapsed('a.com', false);
    await useDataStore.getState().toggleSiteCollapsed('a.com', false);
    expect(useDataStore.getState().collapsedSites).toEqual([]);
  });

  it('reconcileWithTabs：挂起条目导航转正 + 自动建立绑定', async () => {
    useDataStore.setState({
      folders: [
        {
          id: 'f1',
          name: 'F',
          collapsed: false,
          items: [{ id: 'i1', url: '', title: '', pendingTabId: 10, createdAt: 1 }]
        }
      ]
    });

    await useDataStore
      .getState()
      .reconcileWithTabs([makeTab({ id: 10, url: 'https://a.com/', title: 'A' })]);

    const item = useDataStore.getState().folders[0]!.items[0]!;
    expect(item.pendingTabId).toBeUndefined();
    expect(item.url).toBe('https://a.com/');
    expect(item.title).toBe('A');
    // 绑定维护：精确 URL 匹配 → 标签从临时区排除
    const session = await readSession();
    expect(session.itemTabBindings['i1']).toBe(10);
    expect(useDataStore.getState().boundTabIds).toContain(10);
  });

  it('reconcileWithTabs：挂起标签已关闭则条目移除', async () => {
    useDataStore.setState({
      folders: [
        {
          id: 'f1',
          name: 'F',
          collapsed: false,
          items: [{ id: 'i1', url: '', title: '', pendingTabId: 10, createdAt: 1 }]
        }
      ]
    });

    await useDataStore.getState().reconcileWithTabs([]);

    expect(useDataStore.getState().folders[0]!.items).toHaveLength(0);
  });
});
