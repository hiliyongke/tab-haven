// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListNavigation } from '@/entrypoints/sidepanel/hooks/useListNavigation';

/**
 * 列表键盘漫游（↑↓ / Enter）。
 *
 * 回归点：空态漫游是「列表 + 键盘」卖点的一部分 —— 此前只有先输入查询才能
 * 用 ↑↓ 选择，聚焦搜索框直接按 ↑↓ 毫无反应。本测试守住两态共用的语义：
 * 循环移动、Enter 激活并消费按键、序列收缩时索引钳制、换批回到首项。
 */

function key(k: string): KeyboardEvent<HTMLInputElement> {
  return { key: k, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLInputElement>;
}

function setup(ids: readonly number[], onActivate = vi.fn()) {
  return {
    onActivate,
    ...renderHook(({ tabIds, resetKey }) => useListNavigation({ tabIds, resetKey, onActivate }), {
      initialProps: { tabIds: ids as readonly number[], resetKey: 'q' }
    })
  };
}

describe('useListNavigation', () => {
  it('↑↓ 在序列中循环移动并更新选中项', () => {
    const { result } = setup([1, 2, 3]);

    expect(result.current.selectedTabId).toBe(1);

    act(() => {
      expect(result.current.handleKeyDown(key('ArrowDown'))).toBe(true);
    });
    expect(result.current.selectedTabId).toBe(2);

    act(() => {
      result.current.handleKeyDown(key('ArrowDown'));
      result.current.handleKeyDown(key('ArrowDown'));
    });
    // 越界后回到首项（循环而非停住）
    expect(result.current.selectedTabId).toBe(1);

    act(() => {
      result.current.handleKeyDown(key('ArrowUp'));
    });
    // 反向同样循环到末项
    expect(result.current.selectedTabId).toBe(3);
  });

  it('Enter 激活当前项并消费按键', () => {
    const onActivate = vi.fn();
    const { result } = setup([7, 8], onActivate);

    act(() => {
      result.current.handleKeyDown(key('ArrowDown'));
    });
    act(() => {
      expect(result.current.handleKeyDown(key('Enter'))).toBe(true);
    });

    expect(onActivate).toHaveBeenCalledWith(8);
  });

  it('空序列不消费按键（避免吞掉 Esc 等其它处理）', () => {
    const { result } = setup([]);

    expect(result.current.selectedTabId).toBeUndefined();
    expect(result.current.handleKeyDown(key('ArrowDown'))).toBe(false);
    expect(result.current.handleKeyDown(key('Enter'))).toBe(false);
  });

  it('序列收缩（标签被关闭）时索引钳制回界内', () => {
    const { result, rerender } = setup([1, 2, 3]);

    act(() => {
      result.current.handleKeyDown(key('ArrowDown'));
      result.current.handleKeyDown(key('ArrowDown'));
    });
    expect(result.current.selectedTabId).toBe(3);

    // 末项被关闭：索引必须回落到新的末项，而不是悬空成 undefined
    rerender({ tabIds: [1, 2], resetKey: 'q' });
    expect(result.current.selectedTabId).toBe(2);
  });

  it('resetKey 变化（查询词改变）时回到首项', () => {
    const { result, rerender } = setup([1, 2, 3]);

    act(() => {
      result.current.handleKeyDown(key('ArrowDown'));
    });
    expect(result.current.selectedTabId).toBe(2);

    rerender({ tabIds: [1, 2, 3], resetKey: 'new-query' });
    expect(result.current.selectedTabId).toBe(1);
  });
});
