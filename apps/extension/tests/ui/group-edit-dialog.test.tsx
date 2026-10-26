// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GroupEditDialog } from '@/ui/tabs/GroupEditDialog';

/**
 * 组编辑弹窗不得把注释渲染成正文。
 *
 * JSX 只认识「花括号包裹的注释」这一种形态 —— 写成裸块注释时它不是注释，
 * 而是一段 **JsxText 文本节点**，会原样出现在弹窗里（输入框与色板之间），
 * 且它是未经 `t()` 的中文原文，英文模式下直接露中文。
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(): void {
  render(
    <GroupEditDialog
      title="我的分组"
      color="blue"
      onRename={vi.fn()}
      onRecolor={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe('GroupEditDialog 正文纯度', () => {
  it('弹窗正文不含注释标记（裸 /* */ 会被当文本渲染）', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('/*');
    expect(dialog.textContent).not.toContain('*/');
  });

  it('弹窗正文不含注释里的技术术语（说明该段确实只是注释）', () => {
    renderDialog();

    // 注释正文里出现过的字眼若进了 DOM，说明整段被渲染出来了：
    // 只断言 `/*` 会在注释改写为 `//` 时漏掉这条退化。
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('radiogroup');
    expect(dialog.textContent).not.toContain('sr-only legend');
  });

  it('色板仍然渲染（注释移进 {/* */} 后不吞掉真实内容）', () => {
    renderDialog();

    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  });
});
