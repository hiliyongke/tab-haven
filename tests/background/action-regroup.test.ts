// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NO_GROUP } from '@/core/tab-types';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository } from '@/platform/storage/repositories';
import { runActionClickRegroup } from '@/entrypoints/background/actionRegroup';

/**
 * 工具栏「点击即整理」（settings.actionClickMode = 'regroup'）：
 *  - 与面板内快速整理同语义：按站点聚合临时区标签并建原生组；
 *  - 固定空间绑定标签不参与（不会被打散/入组）；
 *  - 无可整理内容时不产生任何写操作。
 *
 * 环境说明：fake-browser 的 tabs.group / tabs.ungroup / tabGroups.update
 * 实现不全（参照 auto-group-sync.test.ts 注入最小实现）。
 *
 * 另：fake-browser 的窗口/标签模型与 Chrome 有两处偏差，直接建标签会因环境而非因
 * 被测逻辑失败——默认窗口（id 0）从未被聚焦，tabs.query({ currentWindow: true })
 * 会同步抛 TypeError；新建标签的 groupId 是 0，而 Chrome 中「未分组」为 -1。
 * 本用例的输入前提就是「当前窗口内一批未分组标签」，故直接注入查询结果。
 */

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

function stubGroupApis(): {
  groupMock: ReturnType<typeof vi.fn>;
  ungroupMock: ReturnType<typeof vi.fn>;
} {
  const groupMock = vi.fn(async () => 91);
  const ungroupMock = vi.fn(async () => {});
  const updateMock = vi.fn(async () => undefined);
  const tabs = fakeBrowser.tabs as unknown as {
    group: typeof groupMock;
    ungroup: typeof ungroupMock;
  };
  tabs.group = groupMock as unknown as typeof tabs.group;
  tabs.ungroup = ungroupMock as unknown as typeof tabs.ungroup;
  const tabGroups = fakeBrowser.tabGroups as unknown as { update: typeof updateMock };
  tabGroups.update = updateMock as unknown as typeof tabGroups.update;
  return { groupMock, ungroupMock };
}

/** 注入「当前窗口」的未分组标签集合，返回其标签 id。 */
function stubCurrentWindowTabs(urls: readonly string[]): number[] {
  const tabs = urls.map((url, index) => ({
    id: index + 1,
    index,
    windowId: 1,
    url,
    pinned: false,
    groupId: NO_GROUP
  }));
  const queryMock = vi.fn(async () => tabs);
  const tabsApi = fakeBrowser.tabs as unknown as { query: typeof queryMock };
  tabsApi.query = queryMock as unknown as typeof tabsApi.query;
  return tabs.map((tab) => tab.id);
}

describe('工具栏一键整理', () => {
  it('同站点多标签聚合成组并返回组数', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS });
    const ids = stubCurrentWindowTabs(['https://a.com/1', 'https://a.com/2']);
    const { groupMock, ungroupMock } = stubGroupApis();

    const count = await runActionClickRegroup();

    expect(count).toBe(1);
    // 临时区无既有原生组 → 不需要打散
    expect(ungroupMock).not.toHaveBeenCalled();
    expect(groupMock).toHaveBeenCalledTimes(1);
    const call = groupMock.mock.calls[0]![0] as { tabIds: number[] };
    expect([...call.tabIds].sort()).toEqual([...ids].sort());
  });

  it('固定空间绑定标签不参与整理（不会被打散/入组）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS });
    const ids = stubCurrentWindowTabs(['https://a.com/1', 'https://a.com/2']);
    const { groupMock, ungroupMock } = stubGroupApis();
    // 与面板侧 fixedExcludedTabIds 同口径：session 绑定把其中一个标签固定到空间条目
    await fakeBrowser.storage.session.set({
      'tabs.session': {
        itemTabBindings: { 'item-1': ids[0]! },
        manualStandaloneTabIds: []
      }
    });

    const count = await runActionClickRegroup();

    // 临时区仅剩 1 个标签，低于成组阈值（默认 2）→ 不产生任何整理动作
    expect(count).toBe(0);
    expect(groupMock).not.toHaveBeenCalled();
    expect(ungroupMock).not.toHaveBeenCalled();
  });

  it('无可整理内容时返回 0 且不产生写操作', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS });
    stubCurrentWindowTabs(['https://a.com/1']);
    const { groupMock, ungroupMock } = stubGroupApis();

    const count = await runActionClickRegroup();

    expect(count).toBe(0);
    expect(groupMock).not.toHaveBeenCalled();
    expect(ungroupMock).not.toHaveBeenCalled();
  });
});
