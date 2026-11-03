// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { translate } from '@/i18n';
import { SettingsOutline } from '@/ui/settings/SettingsOutline';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsOutline 平台 API 降级', () => {
  it('IntersectionObserver 与 matchMedia 缺失时目录仍可点击跳转', () => {
    const originalObserver = globalThis.IntersectionObserver;
    const originalMatchMedia = window.matchMedia;
    Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    Reflect.deleteProperty(window, 'matchMedia');
    const target = document.createElement('section');
    target.id = 'settings.behavior';
    document.body.appendChild(target);
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const focus = vi.fn();
    target.focus = focus;

    const label = translate('交互行为');
    render(<SettingsOutline items={[{ id: 'settings.behavior', label }]} />);
    fireEvent.click(screen.getByRole('link', { name: label }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(focus).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'true');

    target.remove();
    if (originalObserver !== undefined) globalThis.IntersectionObserver = originalObserver;
    if (originalMatchMedia !== undefined) window.matchMedia = originalMatchMedia;
  });

  it('IntersectionObserver 与 matchMedia 抛错时不破坏目录渲染', () => {
    const label = translate('交互行为');
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor() {
          throw new Error('observer unavailable');
        }
      }
    );
    window.matchMedia = (() => {
      throw new Error('matchMedia unavailable');
    }) as unknown as typeof window.matchMedia;
    expect(() =>
      render(<SettingsOutline items={[{ id: 'settings.behavior', label }]} />)
    ).not.toThrow();
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
  });
});
