// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { translate } from '@/i18n';
import { SearchBar } from '@/ui/search/SearchBar';

/**
 * SearchBar 渲染行为规格：
 * 输入实时上抛、Esc 清空、清除按钮出现与聚焦回归、无障碍标签。
 */

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

function renderSearchBar(overrides: Partial<Parameters<typeof SearchBar>[0]> = {}) {
  const props = {
    query: '',
    onChange: vi.fn(),
    inputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
    ...overrides
  };
  const view = render(<SearchBar {...props} />);
  return { view, props };
}

describe('SearchBar', () => {
  it('渲染搜索框与无障碍标签（aria-label）', () => {
    renderSearchBar();
    const input = screen.getByRole('searchbox');
    expect(input).toHaveAccessibleName(translate('搜索标签'));
    expect(input).toHaveAttribute('placeholder', translate('搜索标签（标题 / 网址 / 拼音）'));
  });

  it('输入实时上抛 onChange', () => {
    const { props } = renderSearchBar();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'git' } });
    expect(props.onChange).toHaveBeenCalledWith('git');
  });

  it('Esc 清空查询并退出搜索', () => {
    const { props } = renderSearchBar({ query: 'git' });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(props.onChange).toHaveBeenCalledWith('');
  });

  it('有查询时显示清除按钮，点击后清空并聚焦回输入框', () => {
    const { props } = renderSearchBar({ query: 'git' });
    const clear = screen.getByRole('button', { name: translate('清除搜索') });
    fireEvent.click(clear);
    expect(props.onChange).toHaveBeenCalledWith('');
    // 聚焦回归：inputRef 在点击后应指向获得焦点的元素
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('空查询时不渲染清除按钮', () => {
    renderSearchBar({ query: '' });
    expect(screen.queryByRole('button', { name: translate('清除搜索') })).toBeNull();
  });
});
