// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP } from '@/core/tab-types';
import type { UndoTabRecord } from '@/core/schema/models';
import { clearDiagnosticBuffer, readDiagnostics } from '@/platform/log';
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
  clearDiagnosticBuffer();
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
    expect(result.createdTabIds).toEqual(created.map((tab) => tab.id));
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

  it('同批同一旧组的多个标签只重建一个组并返回实际新建 id', async () => {
    const { group, update } = stubGroupApis();
    group.mockImplementation(async (options: { tabIds?: number[]; groupId?: number }) => {
      if (options.groupId === 5) throw new Error('group gone');
      return 77;
    });
    const getStub = vi.fn(async () => {
      throw new Error('group gone');
    });
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;

    const result = await restoreTabRecordsDetailed(
      [
        record({ url: 'https://g1.com/', index: 0, groupId: 5, groupName: '工作' }),
        record({ url: 'https://g2.com/', index: 1, groupId: 5, groupName: '工作' })
      ],
      WINDOW_ID
    );

    expect(group).toHaveBeenCalledTimes(2);
    expect(group.mock.calls[0]![0]).toEqual({ tabIds: [expect.any(Number)] });
    expect(group.mock.calls[1]![0]).toEqual({ tabIds: [expect.any(Number)], groupId: 77 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.createdTabIds).toHaveLength(2);
  });

  it('不同旧组即使同名也分别重建', async () => {
    const { group } = stubGroupApis();
    let nextGroupId = 77;
    group.mockImplementation(async (options: { tabIds?: number[]; groupId?: number }) => {
      if (options.groupId !== undefined) throw new Error('group gone');
      const id = nextGroupId;
      nextGroupId += 1;
      return id;
    });
    const getStub = vi.fn(async () => {
      throw new Error('group gone');
    });
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;

    await restoreTabRecordsDetailed(
      [
        record({ url: 'https://g1.com/', groupId: 5, groupName: '工作' }),
        record({ url: 'https://g2.com/', groupId: 6, groupName: '工作' })
      ],
      WINDOW_ID
    );

    expect(group).toHaveBeenCalledTimes(2);
    expect(group.mock.calls.every((call) => call[0].groupId === undefined)).toBe(true);
  });

  it('新建组 id 撞上另一旧组 id 时仍分别重建同名组', async () => {
    // Given 旧组 5 重建后恰好得到 id=6，而另一条记录的旧组 id 也是 6。
    const { group, update } = stubGroupApis();
    let nextGroupId = 6;
    group.mockImplementation(async (options: { tabIds?: number[]; groupId?: number }) => {
      if (options.groupId !== undefined) return options.groupId;
      const id = nextGroupId;
      nextGroupId += 1;
      return id;
    });
    const getStub = vi.fn(async (groupId: number) => {
      if (groupId === 5) throw new Error('group gone');
      return { id: groupId, title: '工作' };
    });
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;

    // When 恢复两个同名但来源不同的旧组。
    const result = await restoreTabRecordsDetailed(
      [
        record({ url: 'https://g1.com/', groupId: 5, groupName: '工作' }),
        record({ url: 'https://g2.com/', groupId: 6, groupName: '工作' })
      ],
      WINDOW_ID
    );

    // Then 第二个旧组不得把第一个新建组误认为自己的原组。
    expect(group).toHaveBeenCalledTimes(2);
    expect(group.mock.calls.every((call) => call[0].groupId === undefined)).toBe(true);
    expect(update).toHaveBeenNthCalledWith(1, 6, { title: '工作' });
    expect(update).toHaveBeenNthCalledWith(2, 7, { title: '工作' });
    expect(result.createdTabIds).toHaveLength(2);
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
    expect(result.degraded).toBe(true);
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
    expect(result.createdTabIds).toEqual([]);
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

  it('标签创建成功但静音回写失败时不把记录留作无法重试的失败项', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never);
    vi.spyOn(fakeBrowser.tabs, 'update').mockRejectedValue(
      new Error('muted update failed') as never
    );

    const result = await restoreTabRecordsDetailed(
      [record({ url: 'https://muted.example/', muted: true })],
      WINDOW_ID
    );

    expect(result.count).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(
      (await fakeBrowser.tabs.query({ windowId: WINDOW_ID })).filter(
        (tab) => tab.url === 'https://muted.example/'
      )
    ).toHaveLength(1);
  });

  it('新建组标题回写失败时保留组 id，同旧组后续标签仍加入该组', async () => {
    // Given 首个新组已创建，但标题回写失败。
    const { group, update } = stubGroupApis();
    update.mockRejectedValue(new Error('title update failed'));
    const getStub = vi.fn(async () => {
      throw new Error('group gone');
    });
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;

    // When 同一旧组恢复两条记录。
    const result = await restoreTabRecordsDetailed(
      [
        record({ url: 'https://g1.com/', groupId: 5, groupName: '工作' }),
        record({ url: 'https://g2.com/', groupId: 5, groupName: '工作' })
      ],
      WINDOW_ID
    );

    // Then 不因标题失败而再建重复组；标签已创建，仅整体标记降级。
    expect(group).toHaveBeenCalledTimes(2);
    expect(group.mock.calls[0]![0]).toEqual({ tabIds: [expect.any(Number)] });
    expect(group.mock.calls[1]![0]).toEqual({ tabIds: [expect.any(Number)], groupId: 77 });
    expect(result.count).toBe(2);
    expect(result.failed).toEqual([]);
    expect(result.degraded).toBe(true);
  });

  it('加入本批重建组失败时保留新建标签并反馈 degraded', async () => {
    // Given 首个标签建组成功，第二个标签加入该组失败。
    const { group } = stubGroupApis();
    group.mockImplementation(async (options: { tabIds?: number[]; groupId?: number }) => {
      if (options.groupId === 5) throw new Error('group gone');
      if (options.groupId === 77) throw new Error('join failed');
      return 77;
    });
    const getStub = vi.fn(async () => {
      throw new Error('group gone');
    });
    (fakeBrowser.tabGroups as unknown as { get: typeof getStub }).get = getStub;

    // When 同一旧组恢复两条记录。
    const result = await restoreTabRecordsDetailed(
      [
        record({ url: 'https://g1.com/', groupId: 5, groupName: '工作' }),
        record({ url: 'https://g2.com/', groupId: 5, groupName: '工作' })
      ],
      WINDOW_ID
    );

    // Then 加入失败不把已创建标签误记为可重试失败项。
    expect(result.count).toBe(2);
    expect(result.createdTabIds).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.degraded).toBe(true);
  });

  it('分组最终恢复失败时反馈 degraded，且诊断不记录用户组名', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const group = vi.fn(async () => {
      throw new Error('group unavailable');
    });
    (fakeBrowser.tabs as unknown as { group: typeof group }).group = group as never;
    const get = vi.fn(async () => ({ id: 5, title: '私人标签组名称' }));
    (fakeBrowser.tabGroups as unknown as { get: typeof get }).get = get as never;

    const result = await restoreTabRecordsDetailed(
      [record({ url: 'https://grouped.example/', groupId: 5, groupName: '私人标签组名称' })],
      WINDOW_ID
    );

    expect(result.count).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(group).toHaveBeenCalledTimes(2);
    expect(readDiagnostics().some((entry) => entry.message.includes('私人标签组名称'))).toBe(false);
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
