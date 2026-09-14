// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { pinsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import {
  COLLAPSE_RMW_LOCK,
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  SETTINGS_RMW_LOCK
} from '@/platform/storage/crossPageLock';
import { SNAPSHOTS_RMW_LOCK } from '@/platform/snapshot/snapshots';
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

  /**
   * 回归：备份整表替换 folders，而会话绑定（item id → tab id）的有效性只校验
   * 「item 与 tab 都还存在」，不校验 URL 是否仍匹配（见 core/fixed/Reconcile 的
   * reconcileBindings）。导入后同 id 的条目可能已指向另一个网址，残留绑定在新数据下
   * 依然「item 与 tab 都存在」，按存在性校验识别不出来 —— 后果是无关标签被永久排除
   * 出临时区（用户视角「标签凭空消失」），且点击该条目会激活内容不相干的标签。
   * 故导入成功后整表清空，由下一次 reconcileWithTabs 按 URL 精确重建。
   */
  it('importData：整表替换 folders 后清空会话绑定（残留绑定会指向无关标签）', async () => {
    await useDataStore.getState().createFolder('F');
    const folderId = useDataStore.getState().folders[0]!.id;
    await useDataStore
      .getState()
      .addTabsToFolder([makeTab({ id: 7, url: 'https://a.com/', title: 'A' })], folderId);

    const itemId = useDataStore.getState().folders[0]!.items[0]!.id;
    expect((await readSession()).itemTabBindings[itemId]).toBe(7);

    // 备份文件可被任意构造：同 item id、不同 URL 是最典型的脏绑定来源。
    await useDataStore.getState().importData({
      format: 'tabs.export',
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

  /**
   * 回归：导入事务此前只有 snapshots 走了跨页 RMW 锁，folders / pins 是裸写 ——
   * 而 background 的右键菜单加条目（contextMenus.addEntryToFolder）与面板的
   * coalesced 写都在锁内做 read→合并→write，锁外整表写会被它们覆盖丢失。
   *
   * jsdom 无 Web Locks（crossPageLock 会退化为直接执行），因此这里给
   * `navigator.locks` 打桩来观测锁名，守住「哪些分区必须加锁」这一契约。
   */
  it('importData：全部整表写分区均经各自的跨页 RMW 锁', async () => {
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

    const requested = await captureLockNames(() => useDataStore.getState().importData(payload));

    expect(requested).toContain(FOLDERS_RMW_LOCK);
    expect(requested).toContain(PINS_RMW_LOCK);
    expect(requested).toContain(SNAPSHOTS_RMW_LOCK);
    // 回归：collapse 与 settings 同样是「多入口各持一份内存的整表写」分区，
    // 此前导入事务在这两处锁外整表覆盖，并发页的折叠状态会被静默抹掉。
    expect(requested).toContain(COLLAPSE_RMW_LOCK);
    expect(requested).toContain(SETTINGS_RMW_LOCK);
  });

  /**
   * 回归：导出入口在设置页（options），而设置页从不加载 snapshotStore。
   * 早期实现走「快照读取桥」，未登记时导出 `snapshots: []`——用户拿这份备份
   * 恢复时快照全丢。现改为直读仓库，与页面是否加载过快照 store 无关。
   */
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

  it('导入事务期间拖入固定空间被跳过（不产生指向不存在条目的脏绑定）', async () => {
    // 回归：importData 期间 writeFolders 会丢弃写入，但 mutateSession 照常执行 ——
    // 会给「根本没进文件夹」的条目建立绑定，且 UI 提示「新增 N 个」而列表毫无变化。
    const folder = await useDataStore.getState().createFolder('F');

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

    // 事务状态必须对 UI 可见：拖拽入口据此拒绝投放并提示，而不是「拖了没反应」。
    expect(useDataStore.getState().importing).toBe(true);
    expect(result).toEqual({ added: 0, moved: 0, skipped: 1 });
    const session = await readSession();
    expect(Object.keys(session.itemTabBindings)).toHaveLength(0);

    setSpy.mockRestore();
    release?.();
    await importing;
    // 事务结束后必须复位，否则固定空间会被永久拒绝投放。
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

  it('降级标志按分区记账：其他分区写成功不得掩盖设置未保存', async () => {
    // 回归：storageDegraded 曾是一个全局布尔，任一分区写成功就整体复位 ——
    // 设置写失败（用户改的设置压根没存）会被随后一次拖拽写成功悄悄抹掉。
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

  it('toggleSiteCollapsed：经 collapse 分区的跨页 RMW 锁（并发页互抹折叠态）', async () => {
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
    // 键名必须与 SyncMirror 的 CHUNK_PREFIX 一致，否则清的是另一个键。
    await fakeBrowser.storage.sync.set({ 'tabs.sync.v1.0': '{"folders":[]}' });

    await useDataStore.getState().resetSettings();

    expect(useDataStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    // 默认值里同步是关闭的：恢复默认等同于「关闭同步」，残留镜像会在下次
    // 首启把数据回灌回来——用户以为已经关干净了。
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

    // 三个存储区全部清空（旧键/遗留键一并带走）
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

  it('clearAllData：重置降级记账（清空后不再提示「可能未保存」）', async () => {
    // 回归：清空数据后存储已恢复正常，若沿用此前的降级记账，
    // 「数据可能未保存」横幅会在用户刚清干净的状态下永久驻留。
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
    // ready: true —— 真实入口（sidepanel/popup）在 initialize 完成前不会协调
    // （reconcileWithTabs 有 ready 守卫：folders 为空是「未加载」而非真实状态，
    // 否则每次挂载首帧会把磁盘绑定整表清空）。
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

  it('initialize：磁盘含同身份重复固定图标时按首个去重（防重复磁贴回归）', async () => {
    // 回归：initialize 曾直接用仓库原值，磁盘/镜像里的重复身份会渲染成两块磁贴
    // （而 watcher 路径是会去重的，表现为「启动时重复、任一外部写入后恢复正常」）。
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
    // ready: true —— 同上方用例：协调是初始化完成后的行为。
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
