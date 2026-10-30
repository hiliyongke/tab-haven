// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DialogShell } from '@/ui/dialog/Dialog';

/** 背景惰性化行为规格：检测 inert 能力时不触发原型访问器，并在弹窗关闭后恢复背景状态。 */

let app: HTMLDivElement;

beforeEach(() => {
  // 惰性化的目标选择器是 `.app, main, #root > *:not(.modal-overlay)`，
  // 测试 DOM 里没有这些节点时循环 0 次，用例就失去意义。
  app = document.createElement('div');
  app.className = 'app';
  document.body.appendChild(app);
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'inert');
  app.remove();
  cleanup();
  vi.restoreAllMocks();
});

describe('背景惰性化的 inert 特性检测', () => {
  it('原型上的 inert getter 不可读时也不得抛错（用 in 检测，不读原型值）', () => {
    Object.defineProperty(HTMLElement.prototype, 'inert', {
      configurable: true,
      get(): boolean {
        throw new TypeError('Illegal invocation');
      },
      set: () => {
        /* 测试不需要记录 getter/setter 的状态。 */
      }
    });

    expect(() =>
      render(
        <DialogShell title="弹窗" onClose={vi.fn()}>
          <p>内容</p>
        </DialogShell>
      )
    ).not.toThrow();
  });

  it('支持 inert 时写元素属性，而不是退化为 aria-hidden', () => {
    const written: boolean[] = [];
    Object.defineProperty(HTMLElement.prototype, 'inert', {
      configurable: true,
      get(): boolean {
        return false;
      },
      set(value: boolean): void {
        written.push(value);
      }
    });

    render(
      <DialogShell title="弹窗" onClose={vi.fn()}>
        <p>内容</p>
      </DialogShell>
    );

    expect(written.length).toBeGreaterThan(0);
    expect(written[0]).toBe(true);
  });

  it('支持 inert 时：弹窗关闭后背景的 inert 复位为 false（不是留在 true）', () => {
    // 用 WeakMap 承载值：既模拟真实访问器，又不需要 any。
    const values = new WeakMap<HTMLElement, boolean>();
    Object.defineProperty(HTMLElement.prototype, 'inert', {
      configurable: true,
      get(this: HTMLElement): boolean {
        return values.get(this) ?? false;
      },
      set(this: HTMLElement, value: boolean): void {
        values.set(this, value);
      }
    });

    const { unmount } = render(
      <DialogShell title="弹窗" onClose={vi.fn()}>
        <p>内容</p>
      </DialogShell>
    );
    expect(app.inert).toBe(true);

    unmount();
    expect(app.inert).toBe(false);
  });

  it('背景原本就 inert 时，弹窗关闭后仍保持原态（不被无条件解禁）', () => {
    app.setAttribute('inert', '');
    const values = new WeakMap<HTMLElement, boolean>();
    Object.defineProperty(HTMLElement.prototype, 'inert', {
      configurable: true,
      get(this: HTMLElement): boolean {
        return values.get(this) ?? false;
      },
      set(this: HTMLElement, value: boolean): void {
        values.set(this, value);
      }
    });

    const { unmount } = render(
      <DialogShell title="弹窗" onClose={vi.fn()}>
        <p>内容</p>
      </DialogShell>
    );
    unmount();

    expect(app.inert).toBe(true);
  });

  it('嵌套弹窗关闭内层时不提前恢复背景，全部关闭后才复位', () => {
    const values = new WeakMap<HTMLElement, boolean>();
    Object.defineProperty(HTMLElement.prototype, 'inert', {
      configurable: true,
      get(this: HTMLElement): boolean {
        return values.get(this) ?? false;
      },
      set(this: HTMLElement, value: boolean): void {
        values.set(this, value);
      }
    });
    const view = (withInner: boolean) => (
      <>
        <DialogShell title="外层" onClose={vi.fn()}>
          <p>外层内容</p>
        </DialogShell>
        {withInner && (
          <DialogShell title="内层" onClose={vi.fn()}>
            <p>内层内容</p>
          </DialogShell>
        )}
      </>
    );

    const { rerender } = render(view(true));
    expect(app.inert).toBe(true);

    rerender(view(false));
    expect(app.inert).toBe(true);

    rerender(<></>);
    expect(app.inert).toBe(false);
  });

  it('不支持 inert 时退化为 aria-hidden，关闭后恢复「原本没有该属性」', () => {
    // 不装原型属性 = jsdom 的默认形态，即降级分支（真实浏览器不会走到）。
    const { unmount } = render(
      <DialogShell title="弹窗" onClose={vi.fn()}>
        <p>内容</p>
      </DialogShell>
    );
    expect(app.getAttribute('aria-hidden')).toBe('true');

    unmount();
    // 原本没有 aria-hidden 的元素，关闭后必须仍是「没有」，不能被补一个 "false"。
    expect(app.hasAttribute('aria-hidden')).toBe(false);
  });

  it('元素自带的 aria-hidden 原值在关闭后被恢复（而不是被顺手摘掉）', () => {
    app.setAttribute('aria-hidden', 'false');

    const { unmount } = render(
      <DialogShell title="弹窗" onClose={vi.fn()}>
        <p>内容</p>
      </DialogShell>
    );
    expect(app.getAttribute('aria-hidden')).toBe('true');

    unmount();
    // 摘掉属性会让这块「本就对读屏隐藏」的内容变成可见，且没有一处代码故意这么做。
    expect(app.getAttribute('aria-hidden')).toBe('false');
  });
});
