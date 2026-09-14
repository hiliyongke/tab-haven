// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import i18n from '@/i18n';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { useSearchController } from '@/entrypoints/sidepanel/hooks/useSearchController';

/**
 * 搜索控制器历史命中规格（P-01）：
 *  - searchHistory 关闭时 historyHits 恒空（引擎不构造）；
 *  - 开启且查询命中快照条目时解码出结构化信息（快照名/来源/时间/条目）；
 *  - 真实标签 id 与历史合成 id 不冲突（历史命中不影响 filteredTabs 主列表）。
 */

function snapTab(url: string, title = ''): SnapshotTab {
  return { url, title, pinned: false, muted: false };
}

function makeSnap(partial: Partial<Snapshot>): Snapshot {
  return {
    id: 's1',
    name: '快照',
    origin: 'manual',
    createdAt: 1,
    tabCount: 1,
    tabs: [],
    ...partial
  };
}

function makeTab(id: number, url: string, title: string): TabRecord {
  return {
    id,
    windowId: 1,
    groupId: -1,
    index: 0,
    title,
    url,
    active: false,
    pinned: false,
    incognito: false,
    muted: false,
    discarded: false,
    audible: false
  };
}

function renderController(overrides: {
  tabs?: TabRecord[];
  snapshots?: Snapshot[];
  searchHistory?: boolean;
  query?: string;
}) {
  const { tabs = [], snapshots = [], searchHistory = true, query = '' } = overrides;
  const rendered = renderHook(
    (props: { tabs: TabRecord[]; snapshots: Snapshot[] }) =>
      useSearchController({
        tabs: props.tabs,
        t: (key, options) => i18n.t(key, options),
        searchAllWindows: false,
        pinyinSearch: false,
        searchHistory,
        snapshots: props.snapshots,
        noCacheEnabled: false,
        noCachePatterns: []
      }),
    {
      initialProps: { tabs, snapshots }
    }
  );
  if (query) {
    act(() => {
      rendered.result.current.setQuery(query);
    });
  }
  return rendered;
}

afterEach(() => {
  cleanup();
});

describe('useSearchController 历史命中（P-01）', () => {
  it('searchHistory 关闭时：查询不产生任何历史命中', async () => {
    const snapshots = [
      makeSnap({
        id: 'h1',
        tabs: [snapTab('https://github.com/torvalds/linux', 'Linux 内核')],
        tabCount: 1
      })
    ];
    const { result } = renderController({
      snapshots,
      searchHistory: false,
      query: 'linux'
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.historyHits).toEqual([]);
  });

  it('开启且命中：解码出快照身份与条目（含命中分段）', async () => {
    const snapshots = [
      makeSnap({
        id: 'h1',
        name: '研究现场',
        origin: 'archive',
        createdAt: 1_700_000_000_000,
        tabs: [snapTab('https://example.com/rust-book', 'The Rust Book')],
        tabCount: 1
      })
    ];
    const { result } = renderController({ snapshots, query: 'rust' });

    await waitFor(() => {
      expect(result.current.historyHits).toHaveLength(1);
    });
    const hit = result.current.historyHits[0]!;
    expect(hit.snapshotId).toBe('h1');
    expect(hit.snapshotName).toBe('研究现场');
    expect(hit.snapshotOrigin).toBe('archive');
    expect(hit.tab.url).toBe('https://example.com/rust-book');
    // 命中分段存在 hit=true 的加粗段
    expect(hit.titleSegments.some((segment) => segment.hit)).toBe(true);
  });

  it('历史命中不污染当前标签过滤：主列表仍只含真实 tabId', async () => {
    const snapshots = [
      makeSnap({
        id: 'h1',
        tabs: [snapTab('https://example.com/match', 'Match In History')],
        tabCount: 1
      })
    ];
    const tabs = [makeTab(7, 'https://other.com', 'Real Tab')];
    const { result } = renderController({ tabs, snapshots, query: 'match' });

    await waitFor(() => {
      expect(result.current.historyHits).toHaveLength(1);
    });
    // 当前窗口无匹配标签 → filteredTabs 为空；命中 id 为负数（合成 id）
    expect(result.current.filteredTabs).toEqual([]);
    expect(result.current.searchHitTabIds.every((id) => id >= 0)).toBe(true);
  });

  it('空查询时历史命中为空（分区仅在过滤态出现）', async () => {
    const snapshots = [
      makeSnap({ id: 'h1', tabs: [snapTab('https://example.com/x', 'X')], tabCount: 1 })
    ];
    const { result } = renderController({ snapshots, query: '' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.historyHits).toEqual([]);
  });
});
