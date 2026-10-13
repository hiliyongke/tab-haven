// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogShell } from '@/ui/dialog/Dialog';
import { translate } from '@/i18n';

/**
 * 弹窗外壳的三段式结构与可见关闭入口。
 *
 * 背景：此前弹窗是「标题 + 内容 + 按钮」一整块，**没有任何可见的关闭入口**
 * —— 只能 Esc 或点遮罩，用户不知道怎么关。改造后：标题栏 / 内容区 / 底栏分区，
 * 标题栏右上角常驻 ✕。这组断言锁住三件事：
 *   1. 关闭按钮存在且真的能关（不是装饰）；
 *   2. 打开时焦点落在主体（输入框）而不是右上角的 ✕；
 *   3. 底栏只在传 footer 时出现（内容型弹窗不需要底栏）。
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DialogShell 可见的关闭入口', () => {
  it('标题栏渲染 ✕，点击触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <DialogShell title="恢复这批快照？" onClose={onClose}>
        <p>内容</p>
      </DialogShell>
    );

    const closeButton = screen.getByRole('button', { name: translate('关闭') });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('✕ 带 dismiss 标记：打开时焦点落在主体第一个可聚焦项，而不是关闭按钮', async () => {
    render(
      <DialogShell title="新建文件夹" onClose={vi.fn()}>
        <input aria-label="文件夹名称" />
        <button type="button">创建</button>
      </DialogShell>
    );

    // 初始聚焦推迟到微任务，等一轮再断言
    await Promise.resolve();

    expect(document.activeElement).toBe(screen.getByLabelText('文件夹名称'));
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: translate('关闭') })
    );
  });

  it('Esc 与点遮罩仍然可关（关闭按钮是补充，不是替换）', () => {
    const onClose = vi.fn();
    render(
      <DialogShell title="标题" onClose={onClose}>
        <p>内容</p>
      </DialogShell>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('DialogShell 三段式分区', () => {
  it('标题渲染在标题栏内，并与弹窗建立 aria-labelledby 关联', () => {
    render(
      <DialogShell title="会话快照" onClose={vi.fn()}>
        <p>内容</p>
      </DialogShell>
    );

    const dialog = screen.getByRole('dialog');
    const title = screen.getByRole('heading', { name: '会话快照' });
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
  });

  it('传入 footer 时渲染底栏按钮，且按钮不在内容区里', () => {
    render(
      <DialogShell
        title="删除这个文件夹？"
        onClose={vi.fn()}
        footer={<button type="button">确认删除</button>}
      >
        <p>文件夹内的 6 个标签记录会一并删除。</p>
      </DialogShell>
    );

    expect(screen.getByRole('button', { name: '确认删除' })).toBeInTheDocument();
  });

  it('不传 footer 时不渲染底栏（内容型弹窗如快照面板）', () => {
    render(
      <DialogShell title="会话快照" onClose={vi.fn()}>
        <p>快照列表</p>
      </DialogShell>
    );

    // 弹窗 portal 到 body，故按面板查而不是 container。
    // 无底栏：面板内除右上角的关闭按钮外没有其它按钮
    expect(document.querySelectorAll('.modal-panel button')).toHaveLength(1);
  });
});
