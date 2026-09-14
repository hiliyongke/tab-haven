// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';
import { SnapshotsPanel } from '@/ui/common/SnapshotsPanel';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useTabStore } from '@/stores/tabStore';

/**
 * 快照面板恢复预览规格（P-02）：
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

/** 渲染面板（P-05 后 props 增加三个洞察行动出口，测试统一注入 noop）。 */
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

describe('SnapshotsPanel 恢复预览（P-02）', () => {
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

  it('取消勾选后按钮计数减少，且按勾选集恢复', async () => {
    const restoreSelected = vi.fn().mockResolvedValue(1);
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

    // 点击恢复：传给 store 的条目应只剩 b.com
    fireEvent.click(screen.getByRole('button', { name: /Restore selected \(1\)/ }));
    await waitFor(() => {
      expect(restoreSelected).toHaveBeenCalledTimes(1);
      const [, selected] = restoreSelected.mock.calls[0] as [string, SnapshotTab[]];
      expect(selected.map((tab) => tab.url)).toEqual(['https://b.com/2']);
    });
  });
});
