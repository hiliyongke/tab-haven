// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP } from '@/core/tab-types';
import type { UndoTabRecord } from '@/core/schema/models';
import { restoreTabRecordsDetailed } from '@/platform/undo/RestoreEngine';

/**
 * 标签恢复行为规格：按位置恢复记录，保留固定、静音和分组状态；返回失败明细，
 * 并按目标窗口中标签的 URL 处理已有页面与重复 URL。
 */

// fake-browser 的窗口 id 恒为 0（tabs.create 不接受自定义 windowId），
// 与本文件所有 query({ windowId }) 断言保持一致。
const WINDOW_ID = 0;

function record(partial: Partial<UndoTabRecord> = {}): UndoTabRecord {
  return {
    url: 'https://a.com/',
    index: 0,
    pinned: false,
    muted: false,
    groupId: NO_GROUP,
    ...partial
  };
}

interface GroupStub {
  group: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function stubGroupApis(): GroupStub {
  const group = vi.fn(async (options: { tabIds?: number[]; groupId?: number }) => {
    // 传入 groupId 时模拟「原组已不存在」：抛错，走按名重建分支。
    if (typeof options.groupId === 'number') throw new Error('group gone');
    return 77;
  });
  const update = vi.fn(async () => undefined);
  const tabs = fakeBrowser.tabs as unknown as { group: typeof group };
  tabs.group = group as unknown as typeof tabs.group;
  const tabGroups = fakeBrowser.tabGroups as unknown as { update: typeof update };
  tabGroups.update = update as unknown as typeof tabGroups.update;
  return { group, update };
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('restoreTabRecordsDetailed', () => {
  it('按 index 升序恢复（加法语义，不关闭现有标签）', async () => {
    const result = await restoreTabRecordsDetailed(
      [record({ index: 2, url: 'https://c.com/' }), record({ index: 0, url: 'https://a.com/' })],
      WINDOW_ID
    );
    expect(result.count).toBe(2);
    // fake-browser 预置了一个无 url 的默认标签页，只断言本次恢复出来的。
    const created = (await fakeBrowser.tabs.query({})).filter((tab) => Boolean(tab.url));
    expect(created.map((tab) => tab.url)).toEqual(['https://a.com/', 'https://c.com/']);
  });

  it('恢复固定与静音状态', async () => {
    const updateSpy = vi.spyOn(fakeBrowser.tabs, 'update');
    await restoreTabRecordsDetailed([record({ url: 'https://m.com/', muted: true })], WINDOW_ID);
    expect(updateSpy).toHaveBeenCalledWith(expect.any(Number), { muted: true });
  });

  it('静音未开启时不调用 update（避免无谓写操作）', async () => {
    const updateSpy = vi.spyOn(fakeBrowser.tabs, 'update');
    await restoreTabRecordsDetailed([record({ url: 'https://q.com/', muted: false })], WINDOW_ID);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('原组存在时回到原组', async () => {
    const { group } = stubGroupApis();
    await restoreTabRecordsDetailed([record({ url: 'https://g.com/', groupId: 5 })], WINDOW_ID);
    expect(group).toHaveBeenCalledWith({ tabIds: [expect.any(Number)], groupId: 5 });
  });

  it('原组已删除时按组名重建', async () => {
    const { group, update } = stubGroupApis();
    // 模拟原组查询失败，恢复操作按组名创建目标组。
    const getStub = vi.fn(async () => {
      throw new Error('group gone');
    });
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;
    await restoreTabRecordsDetailed(
      [record({ url: 'https://g.com/', groupId: 5, groupName: '工作' })],
      WINDOW_ID
    );
    // 恢复到新建的同名组，且仅创建一次。
    expect(group).toHaveBeenCalledTimes(1);
    expect(group.mock.calls[0]![0]).toEqual({ tabIds: [expect.any(Number)] });
    expect(update).toHaveBeenCalledWith(77, { title: '工作' });
  });

  it('groupId 指向名称不符的组时按组名重建', async () => {
    const { group, update } = stubGroupApis();
    const getStub = vi.fn(async () => ({ id: 5, title: '无关组' }));
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;
    await restoreTabRecordsDetailed(
      [record({ url: 'https://g.com/', groupId: 5, groupName: '工作' })],
      WINDOW_ID
    );
    // 名称不符的组不作为恢复目标。
    expect(group).not.toHaveBeenCalledWith(expect.objectContaining({ groupId: 5 }));
    expect(update).toHaveBeenCalledWith(77, { title: '工作' });
  });

  it('groupId 对应组名一致时直接入组（不重建）', async () => {
    const group = vi.fn(async () => 5);
    const tabs = fakeBrowser.tabs as unknown as { group: typeof group };
    tabs.group = group as unknown as typeof tabs.group;
    const getStub = vi.fn(async () => ({ id: 5, title: '工作' }));
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;
    await restoreTabRecordsDetailed(
      [record({ url: 'https://g.com/', groupId: 5, groupName: '工作' })],
      WINDOW_ID
    );
    expect(group).toHaveBeenCalledTimes(1);
    expect(group).toHaveBeenCalledWith({ tabIds: [expect.any(Number)], groupId: 5 });
  });

  it('无组名且组已删除时保持未分组（不抛错、计入成功）', async () => {
    stubGroupApis();
    const result = await restoreTabRecordsDetailed(
      [record({ url: 'https://g.com/', groupId: 5 })],
      WINDOW_ID
    );
    expect(result.count).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it('固定标签不入组（Chrome 不允许固定标签进组）', async () => {
    const { group } = stubGroupApis();
    await restoreTabRecordsDetailed(
      [record({ url: 'https://p.com/', pinned: true, groupId: 5 })],
      WINDOW_ID
    );
    expect(group).not.toHaveBeenCalled();
  });

  it('批次内同 URL 的记录照数恢复（撤销必须还回用户实际关掉的数量）', async () => {
    // 同一批次中的重复 URL 按记录数量分别恢复。
    const result = await restoreTabRecordsDetailed(
      [
        record({ url: 'https://same.com/', index: 0 }),
        record({ url: 'https://same.com/', index: 1 }),
        record({ url: 'https://same.com/', index: 2 })
      ],
      WINDOW_ID
    );
    expect(result.count).toBe(3);
    expect(result.failed).toHaveLength(0);
  });

  it('目标窗口已打开同 URL 时按已恢复计，不新建副本', async () => {
    await fakeBrowser.tabs.create({ url: 'https://open.com/', windowId: WINDOW_ID });
    const result = await restoreTabRecordsDetailed(
      [record({ url: 'https://open.com/', index: 0 })],
      WINDOW_ID
    );
    expect(result.count).toBe(1);
    const opened = (await fakeBrowser.tabs.query({})).filter(
      (tab) => tab.url === 'https://open.com/'
    );
    expect(opened).toHaveLength(1);
  });

  it('无 URL 的记录计入失败明细（而非静默跳过）', async () => {
    const result = await restoreTabRecordsDetailed([record({ url: '' })], WINDOW_ID);
    expect(result.count).toBe(0);
    expect(result.failed).toHaveLength(1);
  });

  it('复用豁免未获确认时计入 degraded（界面不得只报「已恢复 N 个」）', async () => {
    // 复用豁免发放未获确认时，将恢复结果标记为 degraded。
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
      Promise.resolve({ ok: false })) as never);

    const result = await restoreTabRecordsDetailed([record({ url: 'https://a.com/' })], WINDOW_ID);

    expect(result.count).toBe(1);
    expect(result.degraded).toBe(true);
  });

  it('复用豁免获确认时不计入 degraded（正常路径不得误报降级）', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((() =>
      Promise.resolve({ ok: true })) as never);

    const result = await restoreTabRecordsDetailed([record({ url: 'https://a.com/' })], WINDOW_ID);

    expect(result.degraded).toBe(false);
  });

  it('单条创建失败不影响同批其余标签，且失败项进入明细', async () => {
    // 只注入「哪条 URL 会失败」这一个变量，其余走真实的 fake-browser 创建路径。
    const tabs = fakeBrowser.tabs as unknown as {
      create: (options: { url?: string }) => Promise<{ id?: number }>;
    };
    const original = tabs.create.bind(fakeBrowser.tabs);
    tabs.create = vi.fn(async (options: { url?: string }) => {
      if (options.url === 'https://bad.com/') throw new Error('create failed');
      return original(options as Parameters<typeof tabs.create>[0]);
    }) as unknown as typeof tabs.create;

    const result = await restoreTabRecordsDetailed(
      [record({ url: 'https://bad.com/', index: 0 }), record({ url: 'https://ok.com/', index: 1 })],
      WINDOW_ID
    );
    expect(result.count).toBe(1);
    expect(result.failed.map((item) => item.url)).toEqual(['https://bad.com/']);
  });
});
