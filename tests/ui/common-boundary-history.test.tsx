// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useUndoStore } from '@/stores/undoStore';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { UndoHistoryPanel } from '@/ui/common/UndoHistoryPanel';
import type { RecentClosedEntry } from '@/platform/sessions';
import i18n from '@/i18n';

/**
 * `ui/common` 里此前 0% 覆盖的两个组件。
 *
 * **ErrorBoundary** 是整棵 UI 树的最后一道防线：它失效的表现是**白屏**。文案必须走
 * `i18n.t`（类组件拿不到 hooks），因为硬编码中文会让英文用户在最需要看懂说明的时刻
 * 读到看不懂的文字。`componentDidCatch` 还必须把组件栈写进诊断，否则线上只剩一句
 * 「渲染异常」，无从定位。
 *
 * **UndoHistoryPanel** 有两条容易写错的并发/复位契约：
 *  - **恢复互斥**：并发点击不同行会互相覆盖 `restoringId`，先完成的回调把另一行提前解禁；
 *  - **finally 复位**：`sessions.restore` 抛错（sessionId 失效）时必须经 finally 复位，
 *    否则该按钮**永久 disabled 卡死**。
 */

const mocks = vi.hoisted(() => ({
  getRecentlyClosed: vi.fn(async () => [] as RecentClosedEntry[]),
  restoreRecentClosed: vi.fn<(sessionId: string) => Promise<boolean>>(async () => true),
  logFailure: vi.fn()
}));

vi.mock('@/platform/sessions', () => ({
  getRecentlyClosed: mocks.getRecentlyClosed,
  restoreRecentClosed: mocks.restoreRecentClosed
}));

vi.mock('@/platform/diagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/diagnostics')>();
  return { ...actual, logFailure: mocks.logFailure };
});

function closedEntry(
  partial: Partial<RecentClosedEntry> & { sessionId: string }
): RecentClosedEntry {
  return {
    isWindow: false,
    title: `标题-${partial.sessionId}`,
    url: `https://${partial.sessionId}.com/`,
    lastModified: Date.now(),
    ...partial
  };
}

/** 批次夹具：`host` 用于让不同批次可区分（断言顺序时不能靠 index 猜）。 */
function batch(id: string, entryCount = 1, host = 'b') {
  return {
    id,
    createdAt: Date.now(),
    entries: Array.from({ length: entryCount }, (_, index) => ({
      tabId: index,
      url: `https://${host}${index}.com/`,
      title: `T${index}`,
      windowId: 1,
      index
    }))
  };
}

function primeUndoStore(overrides: Partial<ReturnType<typeof useUndoStore.getState>> = {}): {
  undoBatch: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
} {
  const undoBatch = vi.fn(async () => undefined);
  const notify = vi.fn();
  useUndoStore.setState({
    batches: [],
    toast: null,
    ready: true,
    undoing: false,
    undoBatch,
    notify,
    ...overrides
  } as never);
  return { undoBatch, notify };
}

function renderPanel(props: Partial<Parameters<typeof UndoHistoryPanel>[0]> = {}) {
  const onOpenSnapshots = vi.fn();
  const onClose = vi.fn();
  render(
    <UndoHistoryPanel
      hasSnapshots={props.hasSnapshots ?? false}
      onOpenSnapshots={onOpenSnapshots}
      onClose={onClose}
    />
  );
  return { onOpenSnapshots, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  // React 会把错误边界捕获到的异常打印到 console.error，测试输出会被淹没
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.getRecentlyClosed.mockResolvedValue([]);
  mocks.restoreRecentClosed.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  function Boom({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('渲染炸了');
    return <p>正常内容</p>;
  }

  it('无异常时原样渲染子节点（不引入额外包裹）', () => {
    render(
      <ErrorBoundary scope="sidepanel">
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('正常内容')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('errors.boundaryTitle'))).not.toBeInTheDocument();
  });

  it('子节点抛错时降级为错误页并把异常与组件栈写入诊断', () => {
    render(
      <ErrorBoundary scope="popup">
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText(i18n.t('errors.boundaryTitle'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('errors.boundaryBody'))).toBeInTheDocument();
    // 错误信息本身要展示出来，用户反馈问题时有据可依
    expect(screen.getByText('渲染炸了')).toBeInTheDocument();

    expect(mocks.logFailure).toHaveBeenCalledWith(
      'popup',
      '界面渲染异常，已降级为错误页',
      expect.any(Error)
    );
    // 组件栈是定位问题位置的关键，必须单独留痕
    expect(mocks.logFailure).toHaveBeenCalledWith('popup', '组件栈', expect.any(Error));
  });

  it('文案走 i18n 而非硬编码（英文用户在最需要看懂的时刻必须能看懂）', () => {
    render(
      <ErrorBoundary scope="sidepanel">
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    // 断言取的是 i18n 键解析结果，而非某段中文字面量
    expect(screen.getByText(i18n.t('errors.boundaryTitle'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('errors.boundaryRetry') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('errors.boundaryReload') })
    ).toBeInTheDocument();
  });

  it('点击「重试」清空错误态并重新渲染子树', () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('首次渲染失败');
      return <p>恢复了</p>;
    }

    render(
      <ErrorBoundary scope="sidepanel">
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('首次渲染失败')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: i18n.t('errors.boundaryRetry') }));

    expect(screen.getByText('恢复了')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('errors.boundaryTitle'))).not.toBeInTheDocument();
  });

  it('「重新加载」调用 location.reload（最后手段）', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload }
    });

    render(
      <ErrorBoundary scope="options">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('errors.boundaryReload') }));

    expect(reload).toHaveBeenCalled();
  });
});

describe('UndoHistoryPanel 空态与引导', () => {
  it('两处都为空时展示空态文案', async () => {
    primeUndoStore();
    renderPanel();

    expect(await screen.findByText(i18n.t('undo.historyEmpty'))).toBeInTheDocument();
  });

  it('空历史但有快照时给出崩溃引导，点击可跳转快照面板', async () => {
    primeUndoStore();
    const { onOpenSnapshots } = renderPanel({ hasSnapshots: true });

    expect(await screen.findByText(i18n.t('snapshots.crashGuidance'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('snapshots.openSnapshots') }));

    expect(onOpenSnapshots).toHaveBeenCalled();
  });

  it('有历史时不展示崩溃引导（避免误导）', async () => {
    primeUndoStore({ batches: [batch('b1')] as never });
    renderPanel({ hasSnapshots: true });

    await waitFor(() =>
      expect(screen.queryByText(i18n.t('undo.historyEmpty'))).not.toBeInTheDocument()
    );
    expect(screen.queryByText(i18n.t('snapshots.crashGuidance'))).not.toBeInTheDocument();
  });

  it('最近关闭读取失败时降级为空列表（不抛错、不显示错误页）', async () => {
    primeUndoStore();
    mocks.getRecentlyClosed.mockRejectedValueOnce(new Error('sessions unavailable'));

    renderPanel();

    expect(await screen.findByText(i18n.t('undo.historyEmpty'))).toBeInTheDocument();
  });
});

describe('UndoHistoryPanel 撤销栈', () => {
  it('列出批次并逆序展示（栈顶的最新批次在最上）', async () => {
    primeUndoStore({
      batches: [batch('older', 1, 'older'), batch('newer', 1, 'newer')] as never
    });
    renderPanel();

    const buttons = await screen.findAllByTitle(i18n.t('undo.restoreBatch'));
    expect(buttons).toHaveLength(2);
    // 栈数组按时间正序存放，展示时 reverse：最新（newer）在最上
    expect(buttons[0]!.textContent).toContain('newer0.com');
    expect(buttons[1]!.textContent).toContain('older0.com');
  });

  it('多条目批次展示「+N」计数', async () => {
    primeUndoStore({ batches: [batch('b1', 3)] as never });
    renderPanel();

    const button = await screen.findByTitle(i18n.t('undo.restoreBatch'));
    expect(button.textContent).toContain('+2');
  });

  it('点击批次触发 undoBatch 并带上批次 id', async () => {
    const { undoBatch } = primeUndoStore({ batches: [batch('target')] as never });
    renderPanel();

    fireEvent.click(await screen.findByTitle(i18n.t('undo.restoreBatch')));

    expect(undoBatch).toHaveBeenCalledWith('target');
  });

  it('条目无 URL 时展示占位符（不渲染 undefined）', async () => {
    primeUndoStore({
      batches: [
        {
          id: 'b1',
          createdAt: Date.now(),
          entries: [{ tabId: 1, url: undefined, title: '', windowId: 1, index: 0 }]
        }
      ] as never
    });
    renderPanel();

    const button = await screen.findByTitle(i18n.t('undo.restoreBatch'));
    expect(button.textContent).not.toContain('undefined');
  });
});

describe('UndoHistoryPanel 浏览器最近关闭', () => {
  it('标签条目展示标题与 hostname，窗口条目展示标签数文案', async () => {
    primeUndoStore();
    mocks.getRecentlyClosed.mockResolvedValueOnce([
      closedEntry({ sessionId: 'tab1', title: '我的页面', url: 'https://a.com/x' }),
      closedEntry({ sessionId: 'win1', isWindow: true, tabCount: 4, title: '', url: undefined })
    ]);
    renderPanel();

    expect(await screen.findByText('我的页面')).toBeInTheDocument();
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('undo.recentWindow', { count: 4 }))).toBeInTheDocument();
  });

  it('恢复成功提示成功', async () => {
    const { notify } = primeUndoStore();
    mocks.getRecentlyClosed.mockResolvedValueOnce([closedEntry({ sessionId: 's1' })]);
    renderPanel();

    fireEvent.click(await screen.findByText('标题-s1'));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(i18n.t('undo.recentRestored')));
  });

  it('恢复失败（返回 false）提示失败，不谎报成功', async () => {
    const { notify } = primeUndoStore();
    mocks.restoreRecentClosed.mockResolvedValueOnce(false);
    mocks.getRecentlyClosed.mockResolvedValueOnce([closedEntry({ sessionId: 's1' })]);
    renderPanel();

    fireEvent.click(await screen.findByText('标题-s1'));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(i18n.t('errors.operationFailed')));
    expect(notify).not.toHaveBeenCalledWith(i18n.t('undo.recentRestored'));
  });

  it('恢复抛错（sessionId 失效）也会复位按钮，不永久 disabled 卡死', async () => {
    const { notify } = primeUndoStore();
    mocks.restoreRecentClosed.mockRejectedValueOnce(new Error('stale sessionId'));
    mocks.getRecentlyClosed.mockResolvedValueOnce([closedEntry({ sessionId: 's1' })]);
    renderPanel();

    const row = await screen.findByText('标题-s1');
    fireEvent.click(row);

    await waitFor(() => expect(notify).toHaveBeenCalledWith(i18n.t('errors.operationFailed')));

    // 关键：按钮必须恢复可用（finally 复位 restoringId）
    await waitFor(() => {
      const button = row.closest('button');
      expect(button).not.toBeDisabled();
    });
  });

  it('恢复进行中禁用所有行（避免并发恢复互相覆盖）', async () => {
    primeUndoStore();
    let release: ((ok: boolean) => void) | undefined;
    mocks.restoreRecentClosed.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        })
    );
    mocks.getRecentlyClosed.mockResolvedValueOnce([
      closedEntry({ sessionId: 's1', title: '第一行' }),
      closedEntry({ sessionId: 's2', title: '第二行' })
    ]);
    renderPanel();

    fireEvent.click(await screen.findByText('第一行'));

    await waitFor(() => {
      expect(screen.getByText('第二行').closest('button')).toBeDisabled();
    });

    release?.(true);
    await waitFor(() => {
      expect(screen.getByText('第二行').closest('button')).not.toBeDisabled();
    });
  });

  it('正在恢复的那一行展示进度占位（…），而不是时间戳', async () => {
    primeUndoStore();
    let release: ((ok: boolean) => void) | undefined;
    mocks.restoreRecentClosed.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        })
    );
    mocks.getRecentlyClosed.mockResolvedValueOnce([closedEntry({ sessionId: 's1', title: '行' })]);
    renderPanel();

    fireEvent.click(await screen.findByText('行'));

    await waitFor(() => expect(screen.getByText('…')).toBeInTheDocument());

    release?.(true);
  });
});
