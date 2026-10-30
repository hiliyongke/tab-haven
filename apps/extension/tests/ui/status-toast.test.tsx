// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StatusToast } from '@/ui/common/StatusToast';
import { useUndoStore } from '@/stores/undoStore';

/**
 * StatusToast live region 行为规格（§4①）：
 *
 * ARIA 可靠性约束：播报容器必须**预先存在于 DOM 且为空**，之后内容变化才可靠播报。
 * 旧实现 `if (!toast) return null` 让容器随内容一起挂载，首条提示（尤其 polite 的
 * 成功 / 撤销回执）可能被读屏漏报。本文件锁住"两个常驻 region + 内容按 tone 分流"的不变量。
 */

afterEach(() => {
  cleanup();
  useUndoStore.setState({ toast: null });
  vi.restoreAllMocks();
});

describe('StatusToast 常驻 live region', () => {
  it('无 toast 时两个播报 region 仍常驻 DOM 且为空（首次播报不丢）', () => {
    // Given: 没有 toast
    useUndoStore.setState({ toast: null });
    const { container } = render(<StatusToast />);

    // When: 查常驻 live region
    const assertive = container.querySelector('[aria-live="assertive"]');
    const polite = container.querySelector('[aria-live="polite"]');

    // Then: 两者都存在（预先订阅），内容为空，且视觉条不渲染
    expect(assertive).toBeInTheDocument();
    expect(polite).toBeInTheDocument();
    expect(assertive?.textContent).toBe('');
    expect(polite?.textContent).toBe('');
    expect(container.querySelector('.status-toast')).toBeNull();
  });

  it('普通提示走 polite region，视觉条与播报分离（不重复播报）', () => {
    // Given: 一条 info toast（可撤销）
    useUndoStore.setState({
      toast: { message: '已保存快照', canUndo: true, batchId: 'b1', tone: 'info' }
    });
    const { container } = render(<StatusToast />);

    // When: 查两个 region
    const assertive = container.querySelector('[aria-live="assertive"]');
    const polite = container.querySelector('[aria-live="polite"]');

    // Then: 内容只在 polite，assertive 保持空
    expect(polite).toHaveTextContent('已保存快照');
    expect(assertive?.textContent).toBe('');
    // 视觉条本身不再带 role/aria-live，播报不重复
    const visual = container.querySelector('.status-toast');
    expect(visual).toBeInTheDocument();
    expect(visual).not.toHaveAttribute('role');
    expect(visual).not.toHaveAttribute('aria-live');
  });

  it('错误提示走 assertive region（即时打断），polite 保持空', () => {
    // Given: 一条 error toast，带 note
    useUndoStore.setState({
      toast: {
        message: '操作失败',
        canUndo: false,
        batchId: undefined,
        tone: 'error',
        note: '存储不可用'
      }
    });
    const { container } = render(<StatusToast />);

    // When: 查两个 region
    const assertive = container.querySelector('[aria-live="assertive"]');
    const polite = container.querySelector('[aria-live="polite"]');

    // Then: message + note 都在 assertive，polite 空
    expect(assertive).toHaveTextContent('操作失败');
    expect(assertive).toHaveTextContent('存储不可用');
    expect(polite?.textContent).toBe('');
  });

  it('播报区带 aria-atomic，整条消息一次读完', () => {
    useUndoStore.setState({
      toast: { message: '已恢复', canUndo: true, batchId: 'b2', tone: 'info' }
    });
    const { container } = render(<StatusToast />);
    const polite = container.querySelector('[aria-live="polite"]');
    expect(polite).toHaveAttribute('aria-atomic', 'true');
  });
});
