// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';

/**
 * 行为规格（R12 / IX-4 行内上下文菜单）：打开、键盘可达性、关闭与焦点归还。
 *
 * 菜单是 `role="menu"`：ARIA 契约要求方向键在菜单项间移动、Esc 关闭并把焦点
 * 还给触发元素。此前实现只有「挂载聚焦首项 + Esc 关闭」，注释却声明了完整契约
 * —— 键盘用户按 Esc 后焦点掉到 body，得从头 Tab 一遍才能回到刚才那一行。
 */

function Host({
  items,
  onClose,
  anchorRef
}: {
  items: readonly ContextMenuItem[];
  onClose: () => void;
  anchorRef?: { current: HTMLElement | null };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开菜单
      </button>
      {open && (
        <ContextMenu
          x={20}
          y={30}
          items={items}
          anchorRef={anchorRef}
          onClose={() => {
            setOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

function openMenu(items: readonly ContextMenuItem[], onClose: () => void): void {
  render(<Host items={items} onClose={onClose} />);
  const trigger = screen.getByRole('button', { name: '打开菜单' });
  // 必须先聚焦再打开：菜单靠挂载时的 activeElement 记住焦点归还目标。
  trigger.focus();
  fireEvent.click(trigger);
}

/** jsdom 的 getBoundingClientRect 恒为 0，锚点位移只能靠桩来构造。 */
function rectAt(top: number): DOMRect {
  return {
    left: 0,
    top,
    right: 0,
    bottom: top,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

function makeAnchorAt(top: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => rectAt(top);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  cleanup();
  document.body.querySelectorAll('div').forEach((el) => {
    if (!el.className) el.remove();
  });
  vi.restoreAllMocks();
});

describe('ContextMenu 打开与关闭', () => {
  it('打开后渲染全部菜单项并聚焦首项', () => {
    openMenu(
      [
        { label: '关闭标签', onSelect: vi.fn() },
        { label: '固定', onSelect: vi.fn() }
      ],
      vi.fn()
    );

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(2);
    expect(document.activeElement).toBe(menuItems[0]);
  });

  it('点击菜单项触发动作并关闭菜单', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    openMenu([{ label: '关闭标签', onSelect }], onClose);

    fireEvent.click(screen.getByRole('menuitem', { name: '关闭标签' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('点击菜单外部关闭', () => {
    const onClose = vi.fn();
    openMenu([{ label: '关闭标签', onSelect: vi.fn() }], onClose);

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc 关闭并把焦点还给触发元素', () => {
    const onClose = vi.fn();
    openMenu([{ label: '关闭标签', onSelect: vi.fn() }], onClose);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    // 焦点不掉到 body：键盘用户按 Esc 后仍停在刚才那一行。
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开菜单' }));
  });
});

describe('ContextMenu 键盘导航', () => {
  it('↓/↑ 在菜单项间循环移动焦点', () => {
    openMenu(
      [
        { label: '第一项', onSelect: vi.fn() },
        { label: '第二项', onSelect: vi.fn() },
        { label: '第三项', onSelect: vi.fn() }
      ],
      vi.fn()
    );

    const menuItems = screen.getAllByRole('menuitem');
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems[1]);

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems[2]);

    // 到尾回到头（循环）
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems[0]);

    // 到头回到尾（循环）
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(menuItems[2]);
  });

  it('Home / End 跳到首项与末项', () => {
    openMenu(
      [
        { label: '第一项', onSelect: vi.fn() },
        { label: '第二项', onSelect: vi.fn() }
      ],
      vi.fn()
    );

    const menuItems = screen.getAllByRole('menuitem');
    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(menuItems[1]);

    fireEvent.keyDown(document, { key: 'Home' });
    expect(document.activeElement).toBe(menuItems[0]);
  });

  it('锚点随列表滚动时菜单跟着平移（不脱离触发行）', () => {
    const onClose = vi.fn();
    const anchor = makeAnchorAt(100);
    const anchorRef = { current: anchor as HTMLElement | null };
    render(
      <Host
        items={[{ label: '关闭标签', onSelect: vi.fn() }]}
        onClose={onClose}
        anchorRef={anchorRef}
      />
    );
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('menu').style.top).toBe('30px');

    // 锚点随列表下移 40px
    anchor.getBoundingClientRect = () => rectAt(140);
    fireEvent.scroll(window);

    // 菜单同步下移 40px，且不被当成「点外面/取消」而关闭
    expect(screen.getByRole('menu').style.top).toBe('70px');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('锚点元素已随行销毁时关闭菜单（目标行都没了，浮层不该继续挂着）', () => {
    const onClose = vi.fn();
    const anchor = makeAnchorAt(100);
    const anchorRef = { current: anchor as HTMLElement | null };
    render(
      <Host
        items={[{ label: '关闭标签', onSelect: vi.fn() }]}
        onClose={onClose}
        anchorRef={anchorRef}
      />
    );
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    trigger.focus();
    fireEvent.click(trigger);

    anchor.remove();
    fireEvent.scroll(window);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Tab 视为离开菜单：关闭并归还焦点（本组件不入 modalStack，不抢 Tab 陷阱）', () => {
    const onClose = vi.fn();
    openMenu([{ label: '关闭标签', onSelect: vi.fn() }], onClose);

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开菜单' }));
  });
});
