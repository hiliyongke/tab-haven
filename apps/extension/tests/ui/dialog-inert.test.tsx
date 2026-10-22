// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DialogShell } from '@/ui/dialog/Dialog';

/**
 * 背景惰性化（applyBackgroundInert）的「原型访问器」回归。
 *
 * 真实 Chrome 里 `inert` 是 WebIDL 访问器属性：读 `HTMLElement.prototype.inert`
 * 会以 `HTMLElement.prototype` 自身作为 this，而它不是平台对象，Blink 直接抛
 * `Illegal invocation`（与 `Element.prototype.innerHTML` 同类）。
 * jsdom 未实现 inert，读到的是 undefined —— 所以这条 bug 在单测里永远走降级
 * 分支、永远全绿，只有在真实浏览器打开任意弹窗时才崩。
 *
 * 这里人为在原型上装一个「一读就抛」的 getter 来模拟 Blink：实现只要去读
 * 原型值，用例立刻红；用 `in` 做存在性检测则安全通过。
 */

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
        /* 占位：真实实现写入即可 */
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
