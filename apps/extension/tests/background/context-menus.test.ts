import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, PINS_LIMIT } from '@/core/schema/models';
import { createFolder, createFolderItem } from '@/core/fixed/FolderOps';
import {
  foldersRepository,
  pinsRepository,
  settingsRepository
} from '@/platform/storage/repositories';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import {
  CONTEXT_MENU_TITLE_MAX,
  MENU_IDS,
  addEntryToFolder,
  addPinFromTab,
  clearContextMenus,
  discardTabSafely,
  rebuildContextMenus,
  resetContextMenuSignatureForTest,
  setupMenus
} from '@/platform/background/contextMenus';

/**
 * 右键菜单编排。
 *
 * 三类要点：
 *  1. **菜单写操作串行化**：removeAll 与 create 交错会产生重复 id 的 rejection，
 *     所有写操作必须经同一条链；
 *  2. **加入文件夹的安全性**：右键拿到的 linkUrl 由被点击页面提供（页面可控），
 *     `javascript:` / `data:` 一律拒绝且**不回落为原始字符串**；
 *  3. **落盘真实性**：`foldersRepository.write` 返回 false（quota 超限）时必须
 *     返回 false 并提示失败，不能报「已添加」。
 */

/** 安装 contextMenus API，返回 create / removeAll 的 spy。 */
function installMenusApi() {
  // 用 vi.fn<签名>(impl) 而非裸 vi.fn(async (_x) => …)：前者让 mock.calls 的元素类型
  // 变成 [details?]，可直接取 call[0]；用下划线形参则会触发 no-unused-vars。
  const create = vi.fn<(details?: unknown) => Promise<number>>(async () => 1);
  const removeAll = vi.fn(async () => undefined);
  (fakeBrowser as unknown as { contextMenus?: unknown }).contextMenus = { create, removeAll };
  return { create, removeAll };
}

/**
 * 等待模块级串行链推进到至少 n 次 create 调用。
 *
 * 不能用「等几个微任务」草草了事：链里每一环都是 `await`，微任务次数不固定；
 * 而**只断言「不存在」的用例在链未跑完时会因为「什么都还没发生」而假绿**。
 * 因此凡是断言缺席的用例，都先等到该批次应有的调用数到齐再断言。
 */
async function waitForCreates(create: ReturnType<typeof vi.fn>, atLeast: number): Promise<void> {
  await vi.waitFor(() => {
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(atLeast);
  });
}

async function seedFolders(): Promise<void> {
  await foldersRepository.write([
    { ...createFolder('Work'), items: [createFolderItem({ url: 'https://a.com/', title: 'A' })] }
  ]);
}

function rawTab(partial: Record<string, unknown>) {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    status: 'complete',
    lastAccessed: Date.now() - 60_000,
    autoDiscardable: true,
    ...partial
  } as Parameters<typeof discardTabSafely>[0];
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  (fakeBrowser as unknown as { i18n?: unknown }).i18n = { getMessage: vi.fn(() => '') };
  (fakeBrowser as unknown as { notifications?: unknown }).notifications = {
    create: vi.fn(async () => 'id')
  };
  // 菜单签名是模块级状态：不复位时「相同 folders 不重建」会让上一个用例的签名
  // 漏到下一个用例，表现为「什么都没发生」的假绿（同 windowCache 的模块级状态陷阱）。
  resetContextMenuSignatureForTest();
});

afterEach(() => {
  fakeBrowser.reset();
  (fakeBrowser as unknown as { contextMenus?: unknown }).contextMenus = undefined;
  (fakeBrowser as unknown as { i18n?: unknown }).i18n = undefined;
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('setupMenus / rebuildContextMenus', () => {
  it('开关关闭时清空菜单（不残留任何项）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, contextMenusEnabled: false });
    await seedFolders();
    const { create, removeAll } = installMenusApi();

    await setupMenus();
    // 等到 removeAll 真的执行完，此时若还会 create 早已发生 —— 缺席断言才有意义
    await vi.waitFor(() => expect(removeAll).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(create).not.toHaveBeenCalled();
  });

  it('开关开启时重建：基础页面/标签栏/工具栏项恒存在', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, contextMenusEnabled: true });
    await foldersRepository.write([]);
    const { create } = installMenusApi();

    await setupMenus();
    // 无文件夹时应有 3（page）+ 2（tab）+ 3（action）= 8 项
    await waitForCreates(create, 8);

    const seen = create.mock.calls.map((call) => (call[0] as { id: string }).id);
    for (const id of [
      MENU_IDS.pageDiscard,
      MENU_IDS.pagePin,
      MENU_IDS.pageSearchSite,
      MENU_IDS.tabDiscard,
      MENU_IDS.tabSearchSite,
      MENU_IDS.actionOpenPanel,
      MENU_IDS.actionDiscardInactive,
      MENU_IDS.actionSettings
    ]) {
      expect(seen).toContain(id);
    }
  });

  it('无文件夹时不生成「加入文件夹」父项与子项', async () => {
    const { create } = installMenusApi();

    rebuildContextMenus([]);
    await waitForCreates(create, 8);

    const ids = create.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(ids).not.toContain(MENU_IDS.pageFolderParent);
    expect(ids).not.toContain(MENU_IDS.linkFolderParent);
  });

  it('有文件夹时生成页面/链接两侧的子菜单，且子项 parentId 指向父项', async () => {
    const work = createFolder('Work');
    const { create } = installMenusApi();

    rebuildContextMenus([work]);
    // 8 项基础 + 2 父项 + 2 子项 = 12
    await waitForCreates(create, 12);

    const byId = new Map(
      create.mock.calls.map((call) => {
        const arg = call[0] as { id: string; parentId?: string; contexts: string[] };
        return [arg.id, arg] as const;
      })
    );
    const pageChild = byId.get(`th:page:add-folder:${work.id}`);
    const linkChild = byId.get(`th:link:add-folder:${work.id}`);
    expect(pageChild?.parentId).toBe(MENU_IDS.pageFolderParent);
    expect(linkChild?.parentId).toBe(MENU_IDS.linkFolderParent);
    expect(pageChild?.contexts).toEqual(['page']);
    expect(linkChild?.contexts).toEqual(['link']);
  });

  it('签名未变（同样的文件夹列表）时不重建：连续两次不产生新的 create', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, contextMenusEnabled: true });
    await seedFolders();
    const { create } = installMenusApi();

    await setupMenus();
    await waitForCreates(create, 12);
    const afterFirst = create.mock.calls.length;

    // 再跑一次：folders 与开关都没变，不应再走 removeAll + 全量重建（10+N 次 IPC）
    await setupMenus();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(create.mock.calls.length).toBe(afterFirst);
  });

  it('文件夹改名（签名变化）时仍重建', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, contextMenusEnabled: true });
    await seedFolders();
    const { create } = installMenusApi();

    await setupMenus();
    await waitForCreates(create, 12);
    const afterFirst = create.mock.calls.length;

    const folders = await foldersRepository.read();
    await foldersRepository.write(folders.map((folder) => ({ ...folder, name: 'Renamed' })));
    await setupMenus();
    await waitForCreates(create, afterFirst + 12);

    expect(create.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('开关关掉再打开时重建（清空即视为签名失效）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, contextMenusEnabled: true });
    await seedFolders();
    const { create } = installMenusApi();

    await setupMenus();
    await waitForCreates(create, 12);
    const afterFirst = create.mock.calls.length;

    await settingsRepository.write({ ...DEFAULT_SETTINGS, contextMenusEnabled: false });
    await setupMenus();
    await settingsRepository.write({ ...DEFAULT_SETTINGS, contextMenusEnabled: true });
    await setupMenus();

    await waitForCreates(create, afterFirst + 12);
  });

  it('clearContextMenus 只清不建', async () => {
    const { create, removeAll } = installMenusApi();

    clearContextMenus();
    await vi.waitFor(() => expect(removeAll).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(create).not.toHaveBeenCalled();
  });

  it('单个菜单创建失败只丢该项：留痕且后续菜单照常创建（串行链不被污染）', async () => {
    const create = vi
      .fn<(details?: unknown) => Promise<number>>()
      .mockRejectedValueOnce(new Error('duplicate id'))
      .mockResolvedValue(1);
    const removeAll = vi.fn(async () => undefined);
    (fakeBrowser as unknown as { contextMenus?: unknown }).contextMenus = { create, removeAll };

    rebuildContextMenus([]);
    clearContextMenus();

    await vi.waitFor(() =>
      expect(readDiagnostics().some((e) => e.message.includes('右键菜单创建失败'))).toBe(true)
    );
    // 逐项兜底：首项抛错后其余菜单仍被创建（整批串行 await 时会全军覆没）
    await vi.waitFor(() => expect(create.mock.calls.length).toBeGreaterThan(1));
    // 链未被污染：后续 removeAll 仍执行
    await vi.waitFor(() => expect(removeAll).toHaveBeenCalled());
  });
});

describe('addEntryToFolder 安全与落盘真实性', () => {
  it('文件夹不存在返回 failed', async () => {
    await seedFolders();
    await expect(addEntryToFolder('nope', { url: 'https://x.com/', title: 'X' })).resolves.toBe(
      'failed'
    );
  });

  it('非 http(s) 的 URL 被拒绝且不落库（javascript: / data: 不回落为原始字符串）', async () => {
    await seedFolders();
    const folderId = (await foldersRepository.read())[0]!.id;

    await expect(
      addEntryToFolder(folderId, { url: 'javascript:alert(1)', title: 'Evil' })
    ).resolves.toBe('failed');

    const folders = await foldersRepository.read();
    expect(folders[0]!.items.some((item) => item.url?.startsWith('javascript:'))).toBe(false);
  });

  it('URL 已在（任一文件夹中）存在时返回 exists（全局唯一）', async () => {
    await seedFolders();
    const folderId = (await foldersRepository.read())[0]!.id;

    await expect(addEntryToFolder(folderId, { url: 'https://a.com/', title: 'dup' })).resolves.toBe(
      'exists'
    );
  });

  it('新增成功：条目落库、文件夹展开、返回 added', async () => {
    await foldersRepository.write([{ ...createFolder('Work'), collapsed: true, items: [] }]);
    const folderId = (await foldersRepository.read())[0]!.id;

    await expect(
      addEntryToFolder(folderId, { url: 'https://new.com/', title: 'New' })
    ).resolves.toBe('added');

    const folder = (await foldersRepository.read())[0]!;
    expect(folder.collapsed).toBe(false);
    expect(folder.items.map((item) => item.url)).toEqual(['https://new.com/']);
  });

  it('标题超长（页面可控的 selectionText）被截断后落库，写入不失败', async () => {
    await foldersRepository.write([{ ...createFolder('Work'), items: [] }]);
    const folderId = (await foldersRepository.read())[0]!.id;
    // 网页选中文本是页面可控且无长度上限的字符串：不截断即是一条由网页内容
    // 驱动的存储放大面（100KB × 每次右键）。
    const hugeTitle = 'x'.repeat(100 * 1024);

    await expect(
      addEntryToFolder(folderId, { url: 'https://new.com/', title: hugeTitle })
    ).resolves.toBe('added');

    const folder = (await foldersRepository.read())[0]!;
    expect(folder.items).toHaveLength(1);
    expect(folder.items[0]!.title).toHaveLength(CONTEXT_MENU_TITLE_MAX);
  });

  it('落盘失败（quota 超限）返回 failed 并提示，不谎报「已添加」', async () => {
    await seedFolders();
    const folderId = (await foldersRepository.read())[0]!.id;
    vi.spyOn(foldersRepository, 'write').mockResolvedValue(false);

    await expect(
      addEntryToFolder(folderId, { url: 'https://new.com/', title: 'New' })
    ).resolves.toBe('failed');

    const notifications = fakeBrowser as unknown as {
      notifications: { create: ReturnType<typeof vi.fn> };
    };
    expect(notifications.notifications.create).toHaveBeenCalled();
  });
});

describe('addPinFromTab（右键固定的唯一写路径）', () => {
  /** 造满 PINS_LIMIT 条磁贴（真实身份各不相同，故 dedupePins 不会合并）。 */
  async function seedFullPins(): Promise<void> {
    await pinsRepository.write(
      Array.from({ length: PINS_LIMIT }, (_, i) => ({
        id: `pin-${i}`,
        identity: `site-${i}.com`,
        url: `https://site-${i}.com/`,
        title: `Site ${i}`
      }))
    );
  }

  it('正常固定：落库并返回 true', async () => {
    await expect(addPinFromTab({ url: 'https://a.com/', title: 'A' })).resolves.toBe(true);
    expect((await pinsRepository.read()).map((pin) => pin.identity)).toEqual(['a.com']);
  });

  it('非 http(s) / 无 URL 时返回 false 并留痕（不落库）', async () => {
    await expect(addPinFromTab({ url: undefined })).resolves.toBe(false);
    await expect(addPinFromTab({ url: 'javascript:alert(1)' })).resolves.toBe(false);
    expect(await pinsRepository.read()).toHaveLength(0);
    expect(readDiagnostics().some((e) => e.message.includes('固定失败'))).toBe(true);
  });

  it('达到 PINS_LIMIT 时预检拦住：不写盘、返回 false 并留痕（超限数据会让整份备份被拒）', async () => {
    await seedFullPins();

    await expect(addPinFromTab({ url: 'https://new.com/', title: 'New' })).resolves.toBe(false);

    expect(await pinsRepository.read()).toHaveLength(PINS_LIMIT);
    expect(readDiagnostics().some((e) => e.message.includes('上限'))).toBe(true);
  });

  it('已存在的磁贴是原地替换，不受上限约束', async () => {
    await seedFullPins();

    // 第 0 条的身份即 site-0.com：替换它不会让数量增长
    await expect(addPinFromTab({ url: 'https://site-0.com/', title: 'Zero' })).resolves.toBe(true);

    const pins = await pinsRepository.read();
    expect(pins).toHaveLength(PINS_LIMIT);
    expect(pins.find((pin) => pin.identity === 'site-0.com')?.title).toBe('Zero');
  });

  it('落盘失败返回 false（不谎报成功）', async () => {
    vi.spyOn(pinsRepository, 'write').mockResolvedValue(false);
    await expect(addPinFromTab({ url: 'https://a.com/', title: 'A' })).resolves.toBe(false);
  });
});

describe('discardTabSafely', () => {
  it('无标签或标签无 id 时返回 false', async () => {
    await expect(discardTabSafely(undefined)).resolves.toBe(false);
    await expect(discardTabSafely(rawTab({ id: undefined }))).resolves.toBe(false);
  });

  it('不安全（激活/固定/播放中）时返回 false 并提示原因', async () => {
    const discard = vi.fn();
    (fakeBrowser.tabs as unknown as { discard: unknown }).discard = discard;

    await expect(discardTabSafely(rawTab({ active: true }))).resolves.toBe(false);

    expect(discard).not.toHaveBeenCalled();
    const notifications = fakeBrowser as unknown as {
      notifications: { create: ReturnType<typeof vi.fn> };
    };
    expect(notifications.notifications.create).toHaveBeenCalled();
  });

  it('安全标签被执行休眠并提示完成', async () => {
    const discard = vi.fn(async () => undefined);
    (fakeBrowser.tabs as unknown as { discard: unknown }).discard = discard;

    await expect(discardTabSafely(rawTab({ id: 5 }))).resolves.toBe(true);

    expect(discard).toHaveBeenCalledWith(5);
  });

  it('休眠失败返回 false（不误报成功）', async () => {
    (fakeBrowser.tabs as unknown as { discard: unknown }).discard = vi.fn(async () => {
      throw new Error('cannot discard');
    });

    await expect(discardTabSafely(rawTab({ id: 6 }))).resolves.toBe(false);
  });
});
