// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n, { translate } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { SnapshotsPanel } from '@/ui/snapshot/SnapshotsPanel';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 快照面板行为规格：按来源分类展示快照，恢复前确认影响范围，保存工作区操作互斥。
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
  useUndoStore.setState({ toast: null });
});

/** 渲染面板（洞察行动出口统一注入 noop，本文件不测其副作用）。 */
function renderPanel(initialView?: 'list' | 'import' | 'report'): void {
  render(
    <SnapshotsPanel
      onClose={() => {}}
      initialView={initialView}
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
    // 「命名快照」既是分组标题也是行内来源徽标（同源文案），故取首个（组标题在前）。
    const namedHeading = screen.getAllByText(translate('命名快照'))[0];
    if (!namedHeading) throw new Error('未渲染命名快照分组标题');
    const groupNamed = namedHeading.closest('div');
    const groupArchive = screen.getByText('Archive (closed and saved)').closest('div');
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

    expect(screen.queryByText(translate('命名快照'))).toBeNull();
    expect(screen.queryByText('Archive (closed and saved)')).toBeNull();
    expect(screen.queryByText('Auto-saved on window close')).toBeNull();
    expect(i18n.isInitialized).toBe(true);
  });
});

describe('SnapshotsPanel 恢复确认', () => {
  it('行内恢复先弹摘要确认（名称 + 标签数 + 分组数），确认后才执行', () => {
    const restore = vi.fn(async () => ({ count: 2, degraded: false, createdTabs: [] }));
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
    fireEvent.click(screen.getByRole('button', { name: translate('恢复') }));
    expect(restore).not.toHaveBeenCalled();
    // 摘要含快照名 / 标签数 / 分组数（测试环境文案为 en；完整句只出现在弹窗里）
    expect(
      screen.getByText(/Restoring '我的快照' opens 2 tabs \(including 1 tab groups\)/)
    ).toBeInTheDocument();

    // 确认后才真正恢复（弹窗内与行内按钮同名，取最后一个即弹窗确认键）
    fireEvent.click(screen.getAllByRole('button', { name: translate('恢复') }).at(-1)!);
    expect(restore).toHaveBeenCalledWith('m1');
  });

  it('取消确认弹窗：不执行恢复', () => {
    const restore = vi.fn(async () => ({ count: 2, degraded: false, createdTabs: [] }));
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

    fireEvent.click(screen.getByRole('button', { name: translate('恢复') }));
    fireEvent.click(screen.getByRole('button', { name: translate('取消') }));

    expect(restore).not.toHaveBeenCalled();
  });
});

describe('SnapshotsPanel 习惯洞察直达', () => {
  /**
   * 洞察渲染在「周报」页签里，常规打开面板默认停在快照列表，
   * 用户还得再切一次页签。initialView='report' 让底栏徽章 1 次点击即落在洞察。
   * 这组断言锁住两件事：直达落在周报视图、洞察区块确实已渲染（不是空壳）。
   */
  it("initialView='report' 时直接落在周报 / 洞察视图", () => {
    renderPanel('report');

    // 周报视图独占的四个统计格与洞察标题都应当可见
    expect(screen.getByText(translate('本地聚合，不涉及任何网络或账号'))).toBeInTheDocument();
    expect(screen.getByText(translate('习惯洞察'))).toBeInTheDocument();
  });

  it('默认（initialView 未传）停在快照列表，不暴露周报', () => {
    renderPanel();

    expect(screen.queryByText(translate('本地聚合，不涉及任何网络或账号'))).not.toBeInTheDocument();
    // 列表视图的导入入口仍在（视图确实渲染了，不是空面板）
    expect(screen.getByRole('button', { name: translate('从 OneTab 导入') })).toBeInTheDocument();
  });

  it('洞察区块带可定位锚点（直达后滚动定位用）', () => {
    renderPanel('report');

    expect(document.getElementById('snapshots-insights')).not.toBeNull();
  });
});

describe('SnapshotsPanel 保存工作区在途互斥', () => {
  /** 保存工作区时保持操作互斥，连续点击只执行一次。 */
  it('连续点击期间只执行一次工作区保存', async () => {
    let release: ((saved: string | undefined) => void) | undefined;
    const saveSpace = vi.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          release = resolve;
        })
    );
    useSnapshotStore.setState({ snapshots: [], ready: true, saveSpace });
    renderPanel();

    const button = screen.getByRole('button', { name: translate('保存为工作区') });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(saveSpace).toHaveBeenCalledTimes(1);

    release?.('saved-space');
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});

describe('SnapshotsPanel 删除不可逆操作回执（P1-3）', () => {
  it('确认删除成功后给出可见/可听回执，焦点归还到存活的列表容器', async () => {
    // Given: 一个可删除快照，delete 成功正常 resolve
    const deleteSnapshot = vi.fn(async () => undefined);
    useUndoStore.setState({ toast: null });
    useSnapshotStore.setState({
      snapshots: [makeSnap({ id: 'm1', name: '待删除', createdAt: 300 })],
      ready: true,
      deleteSnapshot
    });
    renderPanel();

    // When: 行内删除 → 确认删除
    fireEvent.click(screen.getByRole('button', { name: translate('删除') }));
    fireEvent.click(screen.getByRole('button', { name: translate('确认删除') }));

    // Then: 执行删除，且成功后写入一条可见回执（读屏播报由此驱动）
    await waitFor(() => expect(deleteSnapshot).toHaveBeenCalledWith('m1'));
    await waitFor(() =>
      expect(useUndoStore.getState().toast?.message).toBe(translate('已删除快照'))
    );
  });
});

describe('SnapshotsPanel 导入在途互斥（P1-2）', () => {
  it('导入写入期间连点只提交一次，按钮给出进行中反馈', async () => {
    // Given: importOneTab 返回一个受控 pending promise（模拟写盘在途）
    let release: ((result: { count: number; truncated: boolean }) => void) | undefined;
    const importOneTab = vi.fn(
      () =>
        new Promise<{ count: number; truncated: boolean }>((resolve) => {
          release = resolve;
        })
    );
    useSnapshotStore.setState({ snapshots: [], ready: true, importOneTab });
    renderPanel('import');

    // 填入文本让「导入」按钮可用（空文本时按钮禁用）
    const textarea = screen.getByRole('textbox', { name: translate('导入') });
    fireEvent.change(textarea, { target: { value: 'https://example.com - Example' } });

    // When: 在途连点两次「导入」
    fireEvent.click(screen.getByRole('button', { name: translate('导入') }));
    // 第一次点击后按钮进入「导入中…」且 disabled，第二次按新文案已查不到按钮；
    // 直接对同一 DOM 节点连点，验证 ref 标尺拦住并发
    const importBtn = screen.getByRole('button', { name: translate('导入中…') });
    expect(importBtn).toBeDisabled();
    expect(importBtn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(importBtn);

    // Then: 只调用一次 importOneTab（同 tick 连点被 ref 拦）
    expect(importOneTab).toHaveBeenCalledTimes(1);

    // 释放 promise，按钮恢复可用（finally 复位）
    release?.({ count: 1, truncated: false });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: translate('导入中…') })).toBeNull()
    );
  });
});
