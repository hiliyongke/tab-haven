// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { SearchBar } from '@/ui/search/SearchBar';

/**
 * SearchBar 「包含历史」开关规格（P-01）：
 * 开关仅在装配方传入 showHistoryToggle 时渲染；点击切换并保持焦点回归；
 * 激活态给 aria-pressed 与品牌色类名，供读屏与视觉双通道辨识。
 */

afterEach(() => {
  cleanup();
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

describe('SearchBar 历史开关（P-01）', () => {
  it('未装配历史开关时不渲染按钮（popup 等场景波及面为零）', () => {
    renderSearchBar();
    expect(screen.queryByRole('button', { name: i18n.t('search.historyToggle') })).toBeNull();
  });

  it('开关渲染且默认关闭态：aria-pressed=false、提示为「仅当前」文案', () => {
    renderSearchBar({ showHistoryToggle: true, historyOn: false, onToggleHistory: vi.fn() });
    const toggle = screen.getByRole('button', { name: i18n.t('search.historyToggleOff') });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('开启态：aria-pressed=true、类名带 is-active、提示为「包含历史」文案', () => {
    renderSearchBar({ showHistoryToggle: true, historyOn: true, onToggleHistory: vi.fn() });
    const toggle = screen.getByRole('button', { name: i18n.t('search.historyToggle') });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle.className).toContain('is-active');
  });

  it('点击开关：回调触发一次，焦点回归输入框', () => {
    const onToggleHistory = vi.fn();
    renderSearchBar({ showHistoryToggle: true, historyOn: false, onToggleHistory });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('search.historyToggleOff') }));
    expect(onToggleHistory).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });
});
