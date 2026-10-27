// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { SnapshotsPanel } from '@/ui/snapshot/SnapshotsPanel';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useTabStore } from '@/stores/tabStore';

/**
 * 快照面板恢复预览规格：
 * 展开详情即见三分类摘要（将新建 / 已存在 / 不恢复）；
 * 勾选默认全选，可取消后按勾选集选择性恢复。
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

afterEach(() => {
  cleanup();
  useSnapshotStore.setState({ snapshots: [], ready: false });
  useTabStore.setState({ tabs: [], currentWindowId: 1 });
  vi.restoreAllMocks();
});

/** 渲染面板（洞察行动出口统一注入 noop，本文件不测其副作用）。 */
function renderPanel(): void {
  render(
    <SnapshotsPanel
      onClose={() => {}}
      onCleanDuplicates={() => {}}
      onDiscardInactive={() => {}}
      onArchiveWindow={() => {}}
    />
  );
}

describe('SnapshotsPanel 恢复预览', () => {
  it('展开详情显示三分类摘要：将新建 / 已存在 / 不恢复', async () => {
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({
          id: 'p1',
          name: '预览快照',
          tabs: [
            snapTab('https://new.com/1', '新建条目'),
            snapTab('https://exists.com/1', '已存在条目'),
            snapTab('chrome://settings', '内部页')
          ],
          tabCount: 3
        })
      ],
      ready: true
    });
    // 当前窗口已打开 exists.com 条目 → diff 判为 existing
    useTabStore.setState({
      tabs: [
        {
          id: 11,
          windowId: 1,
          groupId: -1,
          index: 0,
          title: '已开',
          url: 'https://exists.com/1',
          active: true,
          pinned: false,
          incognito: false,
          muted: false,
          discarded: false,
          audible: false
        }
      ],
      currentWindowId: 1
    });

    renderPanel();
    // 断言用英文文案（测试环境 i18n 默认 en）
    fireEvent.click(screen.getByRole('button', { name: 'View tabs in this snapshot' }));

    await waitFor(() => {
      const summary = screen.getByText(/Preview:/);
      expect(summary).toHaveTextContent('1 to open');
      expect(summary).toHaveTextContent('1 already open');
      expect(summary).toHaveTextContent('1 skipped');
    });
  });

  it('默认全选：选择性恢复按钮显示全部条目数', async () => {
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({
          id: 'p2',
          tabs: [snapTab('https://a.com/1'), snapTab('https://b.com/2')],
          tabCount: 2
        })
      ],
      ready: true
    });
    useTabStore.setState({ tabs: [], currentWindowId: 1 });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'View tabs in this snapshot' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Restore selected \(2\)/ })).toBeInTheDocument();
    });
  });

  it('面板打开期间窗口标签变化，预览 diff 实时刷新', async () => {
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({
          id: 'p4',
          tabs: [snapTab('https://live.com/1', '将变化')],
          tabCount: 1
        })
      ],
      ready: true
    });
    // 初始窗口无该 URL → 预览应为「1 to open」
    useTabStore.setState({ tabs: [], currentWindowId: 1 });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'View tabs in this snapshot' }));
    await waitFor(() => {
      expect(screen.getByText(/Preview:/)).toHaveTextContent('1 to open');
    });

    // 面板保持打开，窗口新开该 URL → 预览应翻转为「1 already open」
    useTabStore.setState({
      tabs: [
        {
          id: 21,
          windowId: 1,
          groupId: -1,
          index: 0,
          title: '后开',
          url: 'https://live.com/1',
          active: true,
          pinned: false,
          incognito: false,
          muted: false,
          discarded: false,
          audible: false
        }
      ],
      currentWindowId: 1
    });

    await waitFor(() => {
      expect(screen.getByText(/Preview:/)).toHaveTextContent('0 to open');
      expect(screen.getByText(/Preview:/)).toHaveTextContent('1 already open');
    });
  });

  it('展开 300 条标签的详情：三分类逐条渲染正确（规模回归）', async () => {
    // 规模用例（原实现的 perf 缺陷）：展开清单曾在 snap.tabs.map 内对 diff 的
    // willCreate / existing 各做一次线性 find —— 复杂度 O(条目数 × diff 条目数)，
    // 300 条标签一次展开即数万次比较。改为预建 Set 查表后与 diff 规模无关，
    // 本用例锁住「规模下逐条分类仍然正确」这一行为等价性。
    const count = 150;
    const tabs = [
      ...Array.from({ length: count }, (_, i) => snapTab(`https://new.com/${i}`, `新建 ${i}`)),
      ...Array.from({ length: count }, (_, i) => snapTab(`https://exists.com/${i}`, `已有 ${i}`))
    ];
    useSnapshotStore.setState({
      snapshots: [makeSnap({ id: 'bulk', tabCount: tabs.length, tabs })],
      ready: true
    });
    // 窗口已开 exists.com 的全部条目 → 后半 150 条判为「已存在」
    useTabStore.setState({
      tabs: Array.from({ length: count }, (_, i) => ({
        id: 1000 + i,
        windowId: 1,
        groupId: -1,
        index: i,
        title: `已开 ${i}`,
        url: `https://exists.com/${i}`,
        active: false,
        pinned: false,
        incognito: false,
        muted: false,
        discarded: false,
        audible: false
      })),
      currentWindowId: 1
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'View tabs in this snapshot' }));

    await waitFor(() => {
      expect(screen.getByText(/Preview:/)).toHaveTextContent('150 already open');
    });
    // 逐条徽标：150 条「已存在」，全部是 http(s) 故没有「不恢复」条目
    expect(screen.getAllByText('Already open')).toHaveLength(count);
    expect(screen.queryByText('Skipped')).toBeNull();
  });

  it('取消勾选后按钮计数减少，且按勾选集恢复', async () => {
    const restoreSelected = vi.fn().mockResolvedValue({ count: 1, degraded: false });
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({
          id: 'p3',
          tabs: [snapTab('https://a.com/1'), snapTab('https://b.com/2')],
          tabCount: 2
        })
      ],
      ready: true,
      restoreSelected
    });
    useTabStore.setState({ tabs: [], currentWindowId: 1 });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'View tabs in this snapshot' }));

    // 取消第一条勾选
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Restore selected \(1\)/ })).toBeInTheDocument();
    });

    // 点击恢复：先弹影响面确认（选择性恢复与整份恢复同一闸门），确认后才执行
    fireEvent.click(screen.getByRole('button', { name: /Restore selected \(1\)/ }));
    await waitFor(() => {
      expect(screen.getByText(/Restoring/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole('button', { name: /^Restore$/ }).at(-1)!);
    await waitFor(() => {
      expect(restoreSelected).toHaveBeenCalledTimes(1);
      const [, selected] = restoreSelected.mock.calls[0] as [string, SnapshotTab[]];
      expect(selected.map((tab) => tab.url)).toEqual(['https://b.com/2']);
    });
  });
});
