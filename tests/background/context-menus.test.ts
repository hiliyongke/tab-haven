import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { createFolder, createFolderItem } from '@/core/fixed/FolderOps';
import { foldersRepository, settingsRepository } from '@/platform/storage/repositories';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import {
  MENU_IDS,
  addEntryToFolder,
  clearContextMenus,
  discardTabSafely,
  rebuildContextMenus,
  setupMenus
} from '@/entrypoints/background/contextMenus';

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

  it('clearContextMenus 只清不建', async () => {
    const { create, removeAll } = installMenusApi();

    clearContextMenus();
    await vi.waitFor(() => expect(removeAll).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(create).not.toHaveBeenCalled();
  });

  it('菜单写失败留痕且不阻塞后续写（串行链不被污染）', async () => {
    const create = vi
      .fn<(details?: unknown) => Promise<number>>()
      .mockRejectedValueOnce(new Error('duplicate id'))
      .mockResolvedValue(1);
    const removeAll = vi.fn(async () => undefined);
    (fakeBrowser as unknown as { contextMenus?: unknown }).contextMenus = { create, removeAll };

    rebuildContextMenus([]);
    clearContextMenus();

    await vi.waitFor(() =>
      expect(readDiagnostics().some((e) => e.message.includes('右键菜单写入失败'))).toBe(true)
    );
    // 链未被污染：后续 removeAll 仍执行
    await vi.waitFor(() => expect(removeAll).toHaveBeenCalled());
  });
});

describe('addEntryToFolder 安全与落盘真实性', () => {
  it('文件夹不存在返回 false', async () => {
    await seedFolders();
    await expect(addEntryToFolder('nope', { url: 'https://x.com/', title: 'X' })).resolves.toBe(
      false
    );
  });

  it('非 http(s) 的 URL 被拒绝且不落库（javascript: / data: 不回落为原始字符串）', async () => {
    await seedFolders();
    const folderId = (await foldersRepository.read())[0]!.id;

    await expect(
      addEntryToFolder(folderId, { url: 'javascript:alert(1)', title: 'Evil' })
    ).resolves.toBe(false);

    const folders = await foldersRepository.read();
    expect(folders[0]!.items.some((item) => item.url?.startsWith('javascript:'))).toBe(false);
  });

  it('URL 已在（任一文件夹中）存在时返回 false（全局唯一）', async () => {
    await seedFolders();
    const folderId = (await foldersRepository.read())[0]!.id;

    await expect(addEntryToFolder(folderId, { url: 'https://a.com/', title: 'dup' })).resolves.toBe(
      false
    );
  });

  it('新增成功：条目落库、文件夹展开、返回 true', async () => {
    await foldersRepository.write([{ ...createFolder('Work'), collapsed: true, items: [] }]);
    const folderId = (await foldersRepository.read())[0]!.id;

    await expect(
      addEntryToFolder(folderId, { url: 'https://new.com/', title: 'New' })
    ).resolves.toBe(true);

    const folder = (await foldersRepository.read())[0]!;
    expect(folder.collapsed).toBe(false);
    expect(folder.items.map((item) => item.url)).toEqual(['https://new.com/']);
  });

  it('落盘失败（quota 超限）返回 false 并提示，不谎报「已添加」', async () => {
    await seedFolders();
    const folderId = (await foldersRepository.read())[0]!.id;
    vi.spyOn(foldersRepository, 'write').mockResolvedValue(false);

    await expect(
      addEntryToFolder(folderId, { url: 'https://new.com/', title: 'New' })
    ).resolves.toBe(false);

    const notifications = fakeBrowser as unknown as {
      notifications: { create: ReturnType<typeof vi.fn> };
    };
    expect(notifications.notifications.create).toHaveBeenCalled();
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
