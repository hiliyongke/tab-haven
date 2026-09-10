import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createFolder, createFolderItem } from '@/core/fixed/FolderOps';
import { PENDING_ACTIONS_KEY } from '@/platform/messages';
import { foldersRepository, pinsRepository } from '@/platform/storage/repositories';
import { clearDiagnostics } from '@/platform/diagnostics';
import { handleOmniboxEnter, queryOmnibox } from '@/entrypoints/background/omnibox';

/**
 * 地址栏命令（`t <关键词>`）。
 *
 * 两条安全线必须锁住：
 *  1. **转义**：文件夹名与固定条目标题可来自导入的备份文件，而 Chrome 把建议描述
 *     当受限 XML 解析（支持 `<url>` 等标签），不转义会被当样式指令解析；
 *  2. **回车路径二次校验**：用户可直接敲 `t pin:javascript:...` 而不选建议，
 *     建议列表的过滤拦不住手输内容，因此 `isOpenableUrl` 必须在两个位置各校验一次。
 */

/** 捕获 tabs.create 调用（createTabsWithUrls 的最终出口）。 */
function spyTabCreate() {
  return vi
    .spyOn(fakeBrowser.tabs, 'create')
    .mockImplementation((() => Promise.resolve({ id: 1 })) as never);
}

async function seedFolders(): Promise<void> {
  await foldersRepository.write([
    {
      ...createFolder('Work'),
      items: [
        createFolderItem({ url: 'https://a.com/', title: 'A' }),
        // 挂起条目：尚无 url，恢复时不得把 undefined 传给创建逻辑
        { id: 'pending-1', title: 'Pending', createdAt: Date.now() }
      ]
    },
    createFolder('<script>Evil</script>')
  ]);
}

async function seedPins(): Promise<void> {
  await pinsRepository.write([
    { id: 'p1', identity: 'a.com', url: 'https://a.com/', title: 'Pinned A' },
    { id: 'p2', identity: 'evil', url: 'javascript:alert(1)', title: 'Evil' }
  ]);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);
});

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('queryOmnibox 建议生成', () => {
  it('空输入返回全部文件夹与可打开的固定图标，但不追加搜索项', async () => {
    await seedFolders();
    await seedPins();

    const out = await queryOmnibox('');

    expect(out.filter((s) => s.content.startsWith('folder:'))).toHaveLength(2);
    expect(out.filter((s) => s.content.startsWith('pin:'))).toHaveLength(1);
    expect(out.some((s) => s.content.startsWith('search:'))).toBe(false);
  });

  it('按文件夹名 / 固定图标标题 / 主机名过滤（大小写不敏感）', async () => {
    await seedFolders();
    await seedPins();

    const byFolder = await queryOmnibox('WORK');
    expect(byFolder.some((s) => s.description.includes('Work'))).toBe(true);

    const byTitle = await queryOmnibox('pinned a');
    expect(byTitle.some((s) => s.content === 'pin:https://a.com/')).toBe(true);

    const byHost = await queryOmnibox('a.com');
    expect(byHost.some((s) => s.content === 'pin:https://a.com/')).toBe(true);
  });

  it('有输入时追加站内搜索项', async () => {
    await foldersRepository.write([]);
    await pinsRepository.write([]);

    const out = await queryOmnibox('hello');

    expect(out).toEqual([
      { content: 'search:hello', description: expect.stringContaining('hello') }
    ]);
  });

  it('转义建议描述中的 XML 标记字符（备份文件名可能含 <url> 之类片段）', async () => {
    await seedFolders();
    await pinsRepository.write([]);

    const out = await queryOmnibox('');
    const escaped = out.find((s) => s.content.startsWith('folder:'))!;
    const evil = out.find((s) => s.description.includes('script'))!;

    // 名称里没有特殊字符的项保持原样
    expect(escaped.description).toContain('Work');
    // 含 <> 的名称必须被实体化，不能被当作 XML 标签解析
    expect(evil.description).toContain('&lt;script&gt;Evil&lt;/script&gt;');
    expect(evil.description).not.toContain('<script>');
  });

  it('非 http(s) 的固定图标不给建议（javascript: 等不进入下拉列表）', async () => {
    await foldersRepository.write([]);
    await seedPins();

    const out = await queryOmnibox('');

    expect(out.filter((s) => s.content.startsWith('pin:'))).toHaveLength(1);
    expect(out.some((s) => s.content.includes('javascript:'))).toBe(false);
  });

  it('转义 & 与 >（不只是 <）', async () => {
    await foldersRepository.write([createFolder('A & B > C')]);
    await pinsRepository.write([]);

    const out = await queryOmnibox('');

    expect(out[0]!.description).toContain('A &amp; B &gt; C');
  });
});

describe('handleOmniboxEnter 回车路径', () => {
  it('folder: 打开文件夹内全部可恢复条目（跳过尚无 url 的挂起条目）', async () => {
    await seedFolders();
    const create = spyTabCreate();

    await handleOmniboxEnter(`folder:${(await foldersRepository.read())[0]!.id}`);

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0] as unknown as { url: string };
    expect(arg.url).toBe('https://a.com/');
  });

  it('folder: 指向不存在的文件夹时不创建任何标签', async () => {
    await seedFolders();
    const create = spyTabCreate();

    await handleOmniboxEnter('folder:does-not-exist');

    expect(create).not.toHaveBeenCalled();
  });

  it('pin: http(s) 打开；pin: javascript: 被拒绝（防手输绕过建议过滤）', async () => {
    const create = spyTabCreate();

    await handleOmniboxEnter('pin:https://ok.com/');
    expect(create).toHaveBeenCalledTimes(1);

    await handleOmniboxEnter('pin:javascript:alert(1)');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('search: 打开面板并把搜索动作挂起投递（面板未开时不丢动作）', async () => {
    await handleOmniboxEnter('search:keyword');

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    const list = rec[PENDING_ACTIONS_KEY] as { type: string; query: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'search-domain', query: 'keyword' });
  });

  it('纯文本默认走站内搜索', async () => {
    await handleOmniboxEnter('plain text');

    const rec = await fakeBrowser.storage.session.get(PENDING_ACTIONS_KEY);
    const list = rec[PENDING_ACTIONS_KEY] as { type: string; query: string }[];
    expect(list[0]).toMatchObject({ type: 'search-domain', query: 'plain text' });
  });

  it('newForegroundTab 处置方式透传到标签创建（前台打开）', async () => {
    const create = spyTabCreate();

    await handleOmniboxEnter('pin:https://ok.com/', 'newForegroundTab');

    expect(create.mock.calls[0]![0]).toMatchObject({ active: true });
  });
});
