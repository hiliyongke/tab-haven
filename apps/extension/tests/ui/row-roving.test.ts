// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { useRowRoving } from '@/ui/hooks/useRowRoving';
import { ROW_ACTIVATABLE_ATTR } from '@/ui/domContract';

/**
 * 列表级键盘漫游（useRowRoving）行为规格。
 *
 * 关键契约：
 *  - Home / End 直达首项 / 末项；
 *  - 方向键越界**钳制**不回绕（回绕会让「滚到底又跳回第一条」）；
 *  - 输入框内的方向键一律放行（归搜索漫游与原生光标移动）；
 *  - 带修饰键不接管（Alt+↑↓ 是键盘重排）。
 */

/** 挂在 body 上的监听（漫游 handler 的真实接线方式），afterEach 统一摘除。 */
const attached: EventListener[] = [];

/** 挂载一个含若干可激活行的容器，并返回 handler 与行元素。 */
function setup(rowCount: number) {
  const container = document.createElement('div');
  const rows: HTMLElement[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const row = document.createElement('div');
    row.setAttribute(ROW_ACTIVATABLE_ATTR, '');
    row.tabIndex = 0;
    container.appendChild(row);
    rows.push(row);
  }
  document.body.appendChild(container);
  const ref: RefObject<HTMLElement | null> = { current: container };
  const { result } = renderHook(() => useRowRoving(ref));
  const handler = result.current;
  const keydown = ((event: Event) =>
    handler(event as unknown as Parameters<typeof handler>[0])) as EventListener;
  document.body.addEventListener('keydown', keydown);
  attached.push(keydown);
  /** 焦点落点：断言「键盘漫游把焦点移到了哪一行」。 */
  const focused = (): HTMLElement | null => document.activeElement as HTMLElement | null;
  /** 按键是否被消费（fireEvent 在 preventDefault 后返回 false）。 */
  const press = (target: HTMLElement, key: string, init: Record<string, boolean> = {}): boolean =>
    !fireEvent.keyDown(target, { key, ...init });
  return { rows, focused, press };
}

afterEach(() => {
  for (const fn of attached) document.body.removeEventListener('keydown', fn);
  attached.length = 0;
  document.body.innerHTML = '';
});

describe('useRowRoving', () => {
  it('末项：End 把焦点移到最后一行', () => {
    const { rows, focused, press } = setup(3);
    rows[0]!.focus();

    expect(press(rows[0]!, 'End')).toBe(true);
    expect(focused()).toBe(rows[2]);
  });

  it('首项：Home 把焦点移到第一行', () => {
    const { rows, focused, press } = setup(3);
    rows[2]!.focus();

    expect(press(rows[2]!, 'Home')).toBe(true);
    expect(focused()).toBe(rows[0]);
  });

  it('越界钳制：末行按 ↓ 仍停在末行（不回绕到首行）', () => {
    const { rows, focused, press } = setup(3);
    rows[2]!.focus();

    press(rows[2]!, 'ArrowDown');

    expect(focused()).toBe(rows[2]);
  });

  it('越界钳制：首行按 ↑ 仍停在首行（不回绕到末行）', () => {
    const { rows, focused, press } = setup(3);
    rows[0]!.focus();

    press(rows[0]!, 'ArrowUp');

    expect(focused()).toBe(rows[0]);
  });

  it('方向键在相邻行之间移动（↓ 下一行 / ↑ 上一行）', () => {
    const { rows, focused, press } = setup(3);
    rows[0]!.focus();

    press(rows[0]!, 'ArrowDown');
    expect(focused()).toBe(rows[1]);

    press(rows[1]!, 'ArrowUp');
    expect(focused()).toBe(rows[0]);
  });

  it('焦点不在任何行时：↓ 进首行、↑ 进末行', () => {
    const { rows, focused, press } = setup(3);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.focus();

    press(outside, 'ArrowDown');
    expect(focused()).toBe(rows[0]);

    press(outside, 'ArrowUp');
    expect(focused()).toBe(rows[2]);
  });

  it('输入框放行：↑↓ / Home / End 一律不接管（归搜索漫游与原生光标）', () => {
    const { rows, focused, press } = setup(3);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const before = focused();

    expect(press(input, 'ArrowDown')).toBe(false);
    expect(press(input, 'End')).toBe(false);
    expect(focused()).toBe(before);
    expect(focused()).not.toBe(rows[0]);
  });

  it('带修饰键不接管（Alt+↑↓ 是键盘重排，不能被漫游吞掉）', () => {
    const { rows, focused, press } = setup(3);
    rows[0]!.focus();
    const before = focused();

    expect(press(rows[0]!, 'ArrowDown', { altKey: true })).toBe(false);
    expect(focused()).toBe(before);
  });

  it('容器内无可激活行：不动作也不抛错', () => {
    const { rows, focused, press } = setup(0);
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    expect(press(outside, 'ArrowDown')).toBe(false);
    expect(rows).toEqual([]);
    expect(focused()).not.toBeNull();
  });
});
