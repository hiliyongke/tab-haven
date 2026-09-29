// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { SnapshotsPanel } from '@/ui/common/SnapshotsPanel';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * 快照面板概念收敛规格：
 * 四种 origin 混排在一个列表里时，用户无法判断对象的生命周期与恢复预期。
 * 现按「命名快照 / 归档 / 关窗自动保存」三组展示，每组语义唯一。
 */

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

describe('SnapshotsPanel 分组', () => {
  it('按生命周期分组展示，命名快照与归档不混排', () => {
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({ id: 'm1', name: '我的快照', origin: 'manual', createdAt: 300 }),
        makeSnap({ id: 'a1', name: '归档现场', origin: 'archive', createdAt: 200 }),
        makeSnap({ id: 'auto1', name: '关窗自动', origin: 'auto', createdAt: 100 }),
        makeSnap({ id: 'sp1', name: '工作区', origin: 'space', createdAt: 50 })
      ],
      ready: true
    });

    renderPanel();

    // 断言用英文文案：i18n 默认语言在测试环境下为 en（不依赖浏览器语言）。
    const groupNamed = screen.getByText('Named snapshots').closest('div');
    const groupArchive = screen.getByText('Archives (closed and kept)').closest('div');
    const groupAuto = screen.getByText('Auto-saved on window close').closest('div');

    // 命名快照组含手动快照与轻量空间快照（两者同为「用户主动保存的现场」）
    expect(groupNamed).toHaveTextContent('我的快照');
    expect(groupNamed).toHaveTextContent('工作区');
    expect(groupNamed).not.toHaveTextContent('归档现场');

    // 归档独立成组
    expect(groupArchive).toHaveTextContent('归档现场');
    expect(groupArchive).not.toHaveTextContent('我的快照');

    expect(groupAuto).toHaveTextContent('关窗自动');
  });

  it('无快照时只显示空态，不渲染任何分组标题', () => {
    renderPanel();

    expect(screen.queryByText('Named snapshots')).toBeNull();
    expect(screen.queryByText('Archives (closed and kept)')).toBeNull();
    expect(screen.queryByText('Auto-saved on window close')).toBeNull();
    expect(i18n.isInitialized).toBe(true);
  });
});

describe('SnapshotsPanel 恢复确认（恢复不在撤销栈覆盖范围，必须先见影响面）', () => {
  it('行内恢复先弹摘要确认（名称 + 标签数 + 分组数），确认后才执行', () => {
    const restore = vi.fn(async () => 2);
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({
          id: 'm1',
          name: '我的快照',
          createdAt: 300,
          tabCount: 2,
          tabs: [
            { url: 'https://a.com/', title: 'A', pinned: false, muted: false, groupTitle: '工作' },
            { url: 'https://b.com/', title: 'B', pinned: false, muted: false }
          ]
        })
      ],
      ready: true,
      restore
    });
    renderPanel();

    // 点行内恢复按钮：弹确认，不直接执行
    fireEvent.click(screen.getByRole('button', { name: i18n.t('snapshots.restore') }));
    expect(restore).not.toHaveBeenCalled();
    // 摘要含快照名 / 标签数 / 分组数（测试环境文案为 en；完整句只出现在弹窗里）
    expect(
      screen.getByText(/Restoring "我的快照" will open 2 tabs \(1 groups\)/)
    ).toBeInTheDocument();

    // 确认后才真正恢复（弹窗内与行内按钮同名，取最后一个即弹窗确认键）
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('snapshots.restore') }).at(-1)!);
    expect(restore).toHaveBeenCalledWith('m1');
  });

  it('取消确认弹窗：不执行恢复', () => {
    const restore = vi.fn(async () => 2);
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({
          id: 'm1',
          name: '我的快照',
          createdAt: 300,
          tabCount: 1,
          tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }]
        })
      ],
      ready: true,
      restore
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('snapshots.restore') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dialog.cancel') }));

    expect(restore).not.toHaveBeenCalled();
  });
});
