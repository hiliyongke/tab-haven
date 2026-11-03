// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { translate } from '@/i18n';
import { ConfirmDialog, DialogShell } from '@/ui/dialog/Dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('嵌套 Dialog 焦点契约', () => {
  it('Tab 不逃到外层；Esc 只关栈顶；关闭内层后焦点恢复', async () => {
    const onCancel = vi.fn(() => undefined);
    const outerClose = vi.fn();
    const outerTrigger = document.createElement('button');
    outerTrigger.id = 'outer-trigger';
    outerTrigger.textContent = '外层触发';
    document.body.appendChild(outerTrigger);
    outerTrigger.focus();
    function NestedDialogs() {
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <DialogShell title="外层" onClose={outerClose}>
          <button type="button" id="outer-action" onClick={() => setInnerOpen(true)}>
            外层动作
          </button>
          {innerOpen && (
            <ConfirmDialog
              title="内层确认"
              message="确认"
              inline
              onConfirm={vi.fn()}
              onCancel={() => {
                onCancel();
                setInnerOpen(false);
              }}
            />
          )}
        </DialogShell>
      );
    }
    render(<NestedDialogs />);
    // 外层、内层的初始聚焦各排一个微任务：内层触发元素因此是外层内容按钮。
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: '外层动作' }));
    await Promise.resolve();

    const outerAction = screen.getByRole('button', { name: '外层动作' });
    const innerCancel = screen.getByRole('button', { name: translate('取消') });
    const innerConfirm = screen.getByRole('button', { name: translate('确定') });
    innerCancel.focus();
    expect(screen.getByRole('dialog', { name: '外层' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    const innerDialog = screen.getByRole('dialog', { name: '内层确认' });
    expect(innerDialog).not.toHaveAttribute('aria-modal');
    expect(innerDialog.contains(innerCancel)).toBe(true);
    expect(innerDialog.contains(innerConfirm)).toBe(true);

    expect(document.activeElement).toBe(innerCancel);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(innerDialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(innerDialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole('dialog', { name: '外层' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.queryByRole('dialog', { name: '内层确认' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(outerAction);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledTimes(1);
    outerTrigger.remove();
  });
});
