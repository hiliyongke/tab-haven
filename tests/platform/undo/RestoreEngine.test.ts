// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP } from '@/core/tab-types';
import type { UndoTabRecord } from '@/core/schema/models';
import { restoreTabRecords, restoreTabRecordsDetailed } from '@/platform/undo/RestoreEngine';

/**
 * 标签恢复引擎（撤销栈与快照共用的落盘路径）。
 *
 * 此前零测试，而它是「可重试撤销」承诺的落点：失败明细不准，
 * 用户要么丢数据（整批丢弃），要么重复开标签（整批保留）。
 *
 * fake-browser 未实现 tabs.group / tabGroups.update，按 auto-group-sync.test.ts
 * 的既有范式注入最小实现。
 */

const WINDOW_ID = 1;

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
    await restoreTabRecordsDetailed(
      [record({ url: 'https://g.com/', groupId: 5, groupName: '工作' })],
      WINDOW_ID
    );
    // 第一次带 groupId（失败），第二次只带 tabIds（新建组）
    expect(group).toHaveBeenCalledTimes(2);
    expect(group.mock.calls[1]![0]).toEqual({ tabIds: [expect.any(Number)] });
    expect(update).toHaveBeenCalledWith(77, { title: '工作' });
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

  it('无 URL 的记录计入失败明细（而非静默跳过）', async () => {
    const result = await restoreTabRecordsDetailed([record({ url: '' })], WINDOW_ID);
    expect(result.count).toBe(0);
    expect(result.failed).toHaveLength(1);
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

describe('restoreTabRecords', () => {
  it('兼容入口只返回成功数量', async () => {
    const count = await restoreTabRecords(
      [record({ url: 'https://a.com/', index: 0 }), record({ url: '', index: 1 })],
      WINDOW_ID
    );
    expect(count).toBe(1);
  });
});
