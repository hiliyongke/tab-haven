// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
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

async function seedTabs(urls: readonly string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const url of urls) {
    const tab = await fakeBrowser.tabs.create({ url });
    if (typeof tab.id === 'number') ids.push(tab.id);
  }
  return ids;
}

describe('工具栏一键整理', () => {
  it('同站点多标签聚合成组并返回组数', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS });
    const ids = await seedTabs(['https://a.com/1', 'https://a.com/2']);
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
    const ids = await seedTabs(['https://a.com/1', 'https://a.com/2']);
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
    await seedTabs(['https://a.com/1']);
    const { groupMock, ungroupMock } = stubGroupApis();

    const count = await runActionClickRegroup();

    expect(count).toBe(0);
    expect(groupMock).not.toHaveBeenCalled();
    expect(ungroupMock).not.toHaveBeenCalled();
  });
});
