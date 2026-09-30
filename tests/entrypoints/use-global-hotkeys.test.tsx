// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { useGlobalHotkeys } from '@/entrypoints/sidepanel/hooks/useGlobalHotkeys';

/**
 * 面板全局快捷键（`hooks/useGlobalHotkeys.ts`）。
 *
 * ⌘/Ctrl+Z 撤销的关键契约是**不抢文本编辑场景的原生撤销**——
 * 输入框里的 ⌘Z 必须撤文本而不是恢复标签批次。
 *
 * ⌘/Ctrl+⇧+Z 重做：此前该分支直接 return（无键盘入口），本轮接上 store 的 redo()。
 */

function setup() {
  const handlers = {
    openPalette: vi.fn(),
    locateActive: vi.fn(),
    focusSearch: vi.fn(),
    undoLast: vi.fn(),
    redoLast: vi.fn()
  };
  renderHook(() => useGlobalHotkeys(handlers));
  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('useGlobalHotkeys', () => {
  it('⌘/Ctrl+Z 触发撤销最近一批', () => {
    const handlers = setup();

    fireEvent.keyDown(document, { key: 'z', metaKey: true });

    expect(handlers.undoLast).toHaveBeenCalledTimes(1);
    expect(handlers.openPalette).not.toHaveBeenCalled();
  });

  it('⌘/Ctrl+Z 在输入框内不拦截（原生文本撤销优先）', () => {
    const handlers = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: 'z', metaKey: true });

    expect(handlers.undoLast).not.toHaveBeenCalled();
    input.remove();
  });

  it('⌘/Ctrl+Z 在 contentEditable 内不拦截', () => {
    const handlers = setup();
    const editable = document.createElement('div');
    // jsdom 未实现 isContentEditable 计算（恒为 false），显式打桩模拟可编辑态
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);

    fireEvent.keyDown(editable, { key: 'z', metaKey: true });

    expect(handlers.undoLast).not.toHaveBeenCalled();
    editable.remove();
  });

  it('不带修饰键的 z 不触发（普通打字不受影响）', () => {
    const handlers = setup();

    fireEvent.keyDown(document, { key: 'z' });

    expect(handlers.undoLast).not.toHaveBeenCalled();
  });

  it('⌘/Ctrl+⇧+Z 触发重做（此前无键盘入口）', () => {
    const handlers = setup();

    fireEvent.keyDown(document, { key: 'z', metaKey: true, shiftKey: true });

    expect(handlers.redoLast).toHaveBeenCalledTimes(1);
    expect(handlers.undoLast).not.toHaveBeenCalled();
  });

  it('⌘/Ctrl+⇧+Z 在输入框内不拦截（原生文本重做优先）', () => {
    const handlers = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: 'z', metaKey: true, shiftKey: true });

    expect(handlers.redoLast).not.toHaveBeenCalled();
    input.remove();
  });

  it('既有快捷键不回退：⌘P 仍开命令面板', () => {
    const handlers = setup();

    fireEvent.keyDown(document, { key: 'p', metaKey: true });

    expect(handlers.openPalette).toHaveBeenCalledTimes(1);
  });
});
