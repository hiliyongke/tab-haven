// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FooterToolbar } from '@/entrypoints/sidepanel/FooterToolbar';
import i18n from '@/i18n';

/**
 * 底栏工具区。
 *
 * 重点契约：条件出现的入口（清理重复）不能常驻 —— 无重复时渲染它会让
 * 用户点出一个「没有可清理的重复标签」的提示，等于把按钮做成噪音；
 * 有重复时必须出现、徽章显示待清理数、点按触发清理（清理走撤销管线）。
 */

type FooterProps = Parameters<typeof FooterToolbar>[0];

function renderFooter(overrides: Partial<FooterProps> = {}) {
  const props: FooterProps = {
    tabCount: 5,
    collapsibleCount: 2,
    allCollapsed: false,
    activeTabId: 1,
    discardedCount: 0,
    duplicateCount: 0,
    highlightedCount: 0,
    undoBatchCount: 0,
    snapshotCount: 0,
    quickRegrouping: false,
    footerLabels: true,
    onToggleAllSections: vi.fn(),
    onDiscardInactive: vi.fn(),
    onWakeAll: vi.fn(),
    onQuickRegroup: vi.fn(),
    onCleanDuplicates: vi.fn(),
    onCloseHighlighted: vi.fn(),
    onLocateActive: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenSnapshots: vi.fn(),
    onOpenPalette: vi.fn(),
    ...overrides
  };
  render(<FooterToolbar {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FooterToolbar 清理重复入口', () => {
  it('无重复标签时不渲染清理入口', () => {
    renderFooter({ duplicateCount: 0 });

    expect(
      screen.queryByRole('button', { name: i18n.t('duplicates.cleanHint') })
    ).not.toBeInTheDocument();
  });

  it('有重复标签时出现入口、徽章显示待清理数、点击触发清理', () => {
    const props = renderFooter({ duplicateCount: 3 });

    const button = screen.getByRole('button', { name: i18n.t('duplicates.cleanHint') });
    expect(button).toHaveTextContent('3');

    fireEvent.click(button);
    expect(props.onCleanDuplicates).toHaveBeenCalledTimes(1);
  });
});

describe('FooterToolbar 重排分组入口', () => {
  /**
   * 回归保护：该按钮曾被以「精简底栏」为由下沉到命令面板，被用户要求恢复 ——
   * 它是分组混乱后唯一的一键修复入口，价值不可替代。这组断言把它常驻底栏
   * 这一产品决策固化下来，防止后续再被「优化」掉。
   */
  it('常驻显示，点击触发重排', () => {
    const props = renderFooter();

    const button = screen.getByRole('button', { name: i18n.t('footer.quickRegroupHint') });
    fireEvent.click(button);

    expect(props.onQuickRegroup).toHaveBeenCalledTimes(1);
  });

  it('重排进行中时禁用入口（防重复触发）', () => {
    renderFooter({ quickRegrouping: true });

    expect(screen.getByRole('button', { name: i18n.t('footer.quickRegroupHint') })).toBeDisabled();
  });
});

describe('FooterToolbar 多选批量关闭入口', () => {
  it('多选 ≥2 个时出现入口，点击触发批量关闭', () => {
    const props = renderFooter({ highlightedCount: 3 });

    const button = screen.getByRole('button', {
      name: i18n.t('selection.closeSelected', { count: 3 })
    });
    expect(button).toHaveTextContent('3');

    fireEvent.click(button);
    expect(props.onCloseHighlighted).toHaveBeenCalledTimes(1);
  });

  it('多选仅 1 个（即激活标签自身）时不渲染入口', () => {
    renderFooter({ highlightedCount: 1 });

    expect(
      screen.queryByRole('button', { name: i18n.t('selection.closeSelected', { count: 1 }) })
    ).not.toBeInTheDocument();
  });
});
