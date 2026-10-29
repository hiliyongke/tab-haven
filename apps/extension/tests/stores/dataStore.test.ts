// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, EXPORT_FILE_VERSION } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { pinsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import {
  COLLAPSE_RMW_LOCK,
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  SETTINGS_RMW_LOCK,
  SNAPSHOTS_RMW_LOCK
} from '@/platform/storage/crossPageLock';
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
 * 捕获一段异步过程中请求的跨页锁名。
 *
 * jsdom 不提供 Web Locks，`withCrossPageLock` 会退化为直接执行（见该文件注释），
 * 这使「哪些写入路径加了锁」在测试里完全不可观测 —— 给 `navigator.locks` 打桩后
 * 即可断言并发契约，而不必真的制造跨上下文竞争。
 */
async function captureLockNames(run: () => Promise<void>): Promise<string[]> {
  const requested: string[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (name: string, fn: () => Promise<unknown>) => {
        requested.push(name);
        return fn();
      }
    }
  });
  try {
    await run();
  } finally {
    if (original) Object.defineProperty(navigator, 'locks', original);
    else Reflect.deleteProperty(navigator, 'locks');
  }
  return requested;
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
    // matchMedia 的 polyfill 已统一在 tests/setup.ts（ThemeApplier 依赖它）。
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
      'invalid-tabs-export'
    );
  });

  it('importData：版本不匹配的备份单独报错（UI 据此给出可操作提示）', async () => {
    await expect(
      useDataStore.getState().importData({
        format: 'tabs.export',
        version: EXPORT_FILE_VERSION - 1,
        exportedAt: new Date().toISOString(),
        fixedFolders: [],
        persistentPins: [],
        siteCollapse: [],
        settings: DEFAULT_SETTINGS
      })
    ).rejects.toThrow('export-version-mismatch');
  });

  it('importData：部分分区写入失败时整体回滚（不留下半套数据）', async () => {
    const payload = {
      format: 'tabs.export',
      version: EXPORT_FILE_VERSION,
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
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(((
      items: Record<string, unknown>
    ) => {
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

  /** 导入备份替换固定文件夹后清空会话绑定，后续协调按 URL 建立有效绑定。 */
  it('importData：替换 folders 后清空会话绑定', async () => {
    await useDataStore.getState().createFolder('F');
    const folderId = useDataStore.getState().folders[0]!.id;
    await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 7, url: 'https://a.com/', title: 'A' })], folderId);

    const itemId = useDataStore.getState().folders[0]!.items[0]!.id;
    expect((await readSession()).itemTabBindings[itemId]).toBe(7);

    // 替换为不同 URL 后，原条目的会话绑定应清空。
    await useDataStore.getState().importData({
      format: 'tabs.export',
      version: EXPORT_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      fixedFolders: [
        {
          id: 'f1',
          name: '导入的文件夹',
          collapsed: false,
          items: [{ id: itemId, url: 'https://b.com/', title: 'B', createdAt: 1 }]
        }
      ],
      persistentPins: [],
      siteCollapse: [],
      settings: DEFAULT_SETTINGS
    });

    expect((await readSession()).itemTabBindings).toEqual({});
    expect(useDataStore.getState().boundTabIds).toEqual([]);
  });

  /** 导入事务中的所有整表写分区都使用各自的跨页读改写锁。 */
  it('importData：全部整表写分区均经各自的跨页 RMW 锁', async () => {
    const payload = {
      format: 'tabs.export',
      version: EXPORT_FILE_VERSION,
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

    const requested = await captureLockNames(() => useDataStore.getState().importData(payload));

    expect(requested).toContain(FOLDERS_RMW_LOCK);
    expect(requested).toContain(PINS_RMW_LOCK);
    expect(requested).toContain(SNAPSHOTS_RMW_LOCK);
    // collapse 与 settings 分区同样通过各自的锁执行整表写入。
    expect(requested).toContain(COLLAPSE_RMW_LOCK);
    expect(requested).toContain(SETTINGS_RMW_LOCK);
  });

  /** 导出完整备份时包含快照与归档内容，且不依赖 snapshotStore 是否已加载。 */
  it('exportData：导出为完整备份（含快照与归档，不依赖快照 store 是否已加载）', async () => {
    await snapshotsRepository.write([
      {
        id: 's1',
        name: '归档',
        origin: 'archive',
        createdAt: 1,
        tabCount: 1,
        tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }]
      }
    ]);

    const file = await useDataStore.getState().exportData();
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
      version: EXPORT_FILE_VERSION,
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

  it('导入事务期间拖入固定空间被跳过（不创建会话绑定）', async () => {
    // 导入期间拒绝新增文件夹条目，并保持会话绑定为空。
    const folder = await useDataStore.getState().createFolder('F');
    // createFolder 超限返回 null：前置条件不成立时直接失败，而不是继续跑出假阴性。
    if (!folder) throw new Error('createFolder 应成功创建文件夹');

    // 让 importData 挂在第一次落盘上，制造「事务进行中」窗口。
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockImplementation((() => gate.then(() => undefined)) as never);

    const importing = useDataStore.getState().importData({
      format: 'tabs.export',
      version: EXPORT_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      fixedFolders: [],
      persistentPins: [],
      siteCollapse: [],
      settings: DEFAULT_SETTINGS,
      snapshots: []
    });

    const result = await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 1, url: 'https://a.com/', title: 'A' })], folder.id);

    // importing 状态对 UI 可见，且本次投放结果为 skipped。
    expect(useDataStore.getState().importing).toBe(true);
    expect(result).toEqual({ added: 0, moved: 0, skipped: 1 });
    const session = await readSession();
    expect(Object.keys(session.itemTabBindings)).toHaveLength(0);

    setSpy.mockRestore();
    release?.();
    await importing;
    // 事务结束后允许继续向固定空间投放。
    expect(useDataStore.getState().importing).toBe(false);
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

  it('降级标志按分区记账：其他分区写成功不清除设置写入失败状态', async () => {
    // 设置分区写入失败后，其他分区成功写入不清除该分区的降级状态。
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockImplementation(() => Promise.reject(new Error('quota')) as never);
    await expect(useDataStore.getState().updateSettings({ density: 'compact' })).rejects.toThrow();
    setSpy.mockRestore();
    expect(useDataStore.getState().storageDegraded).toBe(true);

    // 固定文件夹写入恢复正常
    await useDataStore.getState().createFolder('F');

    expect(useDataStore.getState().folders).toHaveLength(1);
    expect(useDataStore.getState().storageDegraded).toBe(true);
  });

  it('折叠站点时使用 collapse 分区的跨页读改写锁', async () => {
    const requested = await captureLockNames(async () => {
      await useDataStore.getState().toggleSiteCollapsed('a.com', true);
    });
    expect(requested).toContain(COLLAPSE_RMW_LOCK);
    expect(useDataStore.getState().collapsedSites).toEqual(['a.com']);
  });

  it('resetSettings：写盘失败时抛错并保持原设置（不谎报已恢复默认）', async () => {
    await useDataStore.getState().updateSettings({ density: 'compact' });
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockImplementation(() => Promise.reject(new Error('quota')) as never);

    await expect(useDataStore.getState().resetSettings()).rejects.toThrow('settings-write-failed');

    expect(useDataStore.getState().settings.density).toBe('compact');
    expect(useDataStore.getState().storageDegraded).toBe(true);
    setSpy.mockRestore();
  });

  it('resetSettings：成功时回落到出厂默认并清掉已上传的同步镜像', async () => {
    await useDataStore.getState().updateSettings({ density: 'compact', syncMirrorEnabled: true });
    // 预置同步镜像，验证恢复默认设置后将其清除。
    await fakeBrowser.storage.sync.set({ 'tabs.sync.v1.0': '{"folders":[]}' });

    await useDataStore.getState().resetSettings();

    expect(useDataStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    // 恢复默认设置会关闭同步并清除已有镜像。
    const mirror = await fakeBrowser.storage.sync.get('tabs.sync.v1.0');
    expect(mirror['tabs.sync.v1.0']).toBeUndefined();
  });

  it('toggleSiteCollapsed：幂等写入', async () => {
    await useDataStore.getState().toggleSiteCollapsed('a.com', true);
    await useDataStore.getState().toggleSiteCollapsed('a.com', true);
    expect(useDataStore.getState().collapsedSites).toEqual(['a.com']);

    await useDataStore.getState().toggleSiteCollapsed('a.com', false);
    await useDataStore.getState().toggleSiteCollapsed('a.com', false);
    expect(useDataStore.getState().collapsedSites).toEqual([]);
  });

  it('clearAllData：清空 local/session/sync 三区存储，内存态重置为默认', async () => {
    // 预置：固定空间 + 快照 + 同步镜像 + 会话绑定
    await useDataStore.getState().createFolder('F');
    await fakeBrowser.storage.local.set({
      'tabs.snapshots.v1': [
        { id: 's1', name: 'S', origin: 'manual', createdAt: 1, tabCount: 0, tabs: [] }
      ]
    });
    await fakeBrowser.storage.sync.set({ 'tabs.sync.v1.meta': JSON.stringify({ count: 0 }) });
    await fakeBrowser.storage.session.set({
      'tabs.session': { itemTabBindings: { i1: 7 }, manualStandaloneTabIds: [] }
    });

    await useDataStore.getState().clearAllData();

    // 三个存储区中的全部键均被清空
    const local = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(local)).toHaveLength(0);
    const sync = await fakeBrowser.storage.sync.get(null);
    expect(Object.keys(sync)).toHaveLength(0);
    const session = await fakeBrowser.storage.session.get(null);
    expect(Object.keys(session)).toHaveLength(0);

    // 内存态重置为默认
    expect(useDataStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(useDataStore.getState().folders).toEqual([]);
    expect(useDataStore.getState().boundTabIds).toEqual([]);
    expect(useDataStore.getState().collapsedSites).toEqual([]);
  });

  it('clearAllData：清空数据后复位存储降级状态', async () => {
    // 先触发设置写入失败，再验证清空数据会复位降级状态。
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockImplementation(() => Promise.reject(new Error('quota')) as never);
    await expect(useDataStore.getState().updateSettings({ density: 'compact' })).rejects.toThrow();
    setSpy.mockRestore();
    expect(useDataStore.getState().storageDegraded).toBe(true);

    await useDataStore.getState().clearAllData();

    expect(useDataStore.getState().storageDegraded).toBe(false);
  });

  it('reconcileWithTabs：挂起条目导航转正 + 自动建立绑定', async () => {
    // 仅在数据就绪后协调条目与标签；初始化期间的空文件夹列表不代表真实状态。
    useDataStore.setState({
      ready: true,
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

  it('initialize：磁盘含同身份重复固定图标时保留首个条目', async () => {
    // 初始化后相同身份的固定图标只保留首次出现的条目。
    await fakeBrowser.storage.local.set({
      [pinsRepository.keyName]: [
        { id: 'p1', identity: 'a.com', url: 'https://a.com/1', title: 'A1' },
        { id: 'p2', identity: 'a.com', url: 'https://a.com/2', title: 'A2' },
        { id: 'p3', identity: 'b.com', url: 'https://b.com/', title: 'B' }
      ]
    });

    await useDataStore.getState().initialize();

    const pins = useDataStore.getState().pins;
    expect(pins.map((pin) => pin.id)).toEqual(['p1', 'p3']);
  });

  it('reconcileWithTabs：挂起标签已关闭则条目移除', async () => {
    // 初始化完成后再协调挂起条目与标签状态。
    useDataStore.setState({
      ready: true,
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
