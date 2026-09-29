// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Snapshot } from '@/core/schema/models';
import { SpaceStrip } from '@/ui/common/SpaceStrip';
import i18n from '@/i18n';

/** 造一份空间快照。 */
function space(id: string, name: string, tabCount: number, createdAt: number): Snapshot {
  return {
    id,
    name,
    origin: 'space',
    createdAt,
    tabCount,
    tabs: []
  };
}

const spaces = [space('s2', '学习', 8, 200), space('s1', '工作', 12, 100)];

afterEach(() => {
  cleanup();
});

/** 组件默认 props（新组件要求 switching / onExit）。 */
function renderStrip(props: Partial<Parameters<typeof SpaceStrip>[0]> = {}) {
  return render(
    <SpaceStrip
      spaces={spaces}
      activeSpaceId={undefined}
      switching={false}
      onSwitch={() => {}}
      onExit={() => {}}
      onSaveAs={() => {}}
      {...props}
    />
  );
}

describe('SpaceStrip（C1 工作空间切换条）', () => {
  it('渲染空间 chip（含标签计数）与「存为空间」入口', () => {
    renderStrip();

    expect(screen.getByRole('button', { name: /工作/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /学习/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(i18n.t('spaces.saveAs')) })
    ).toBeInTheDocument();
  });

  it('激活空间 aria-pressed=true；同时提供「全部标签」出口', () => {
    renderStrip({ activeSpaceId: 's1' });

    expect(screen.getByRole('button', { name: /工作/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /学习/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: i18n.t('spaces.allTabs') })).toBeInTheDocument();
  });

  it('未激活空间时不显示「全部标签」出口（本来就在该态）', () => {
    renderStrip({ activeSpaceId: undefined });

    expect(screen.queryByRole('button', { name: i18n.t('spaces.allTabs') })).toBeNull();
  });

  it('切换在途时全部入口禁用（防连点重入）', () => {
    renderStrip({ activeSpaceId: 's1', switching: true });

    expect(screen.getByRole('button', { name: /学习/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: i18n.t('spaces.allTabs') })).toBeDisabled();
  });

  it('点击「全部标签」触发退出空间', () => {
    const onExit = vi.fn();
    renderStrip({ activeSpaceId: 's1', onExit });

    fireEvent.click(screen.getByRole('button', { name: i18n.t('spaces.allTabs') }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('点击空间 chip 触发切换，点击「存为空间」触发保存', () => {
    const onSwitch = vi.fn();
    const onSaveAs = vi.fn();
    renderStrip({ onSwitch, onSaveAs });

    fireEvent.click(screen.getByRole('button', { name: /学习/ }));
    expect(onSwitch).toHaveBeenCalledWith(spaces[0]);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('spaces.saveAs')) }));
    expect(onSaveAs).toHaveBeenCalledTimes(1);
  });

  it('无空间快照时整条隐藏（不占位）', () => {
    const { container } = renderStrip({ spaces: [] });

    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});
