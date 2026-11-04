import { beforeEach } from 'vitest';

/**
 * 全局测试准备（vitest setupFiles）。
 *
 * `window.matchMedia` 的 polyfill 在多个测试文件里各写一遍（jsdom 未实现，
 * 而 ThemeApplier 依赖它）。集中到此处后，新写的 UI/stores 测试不必再复制粘贴，
 * 也不会因为漏写而在「单独跑通过、加一个用例就崩」上浪费时间。
 */

/**
 * jsdom 未实现 `<dialog>` 的 `showModal` / `close`。
 *
 * 多个组件依赖它：`OnboardingTour`、`DialogShell`（确认弹窗）、`CommandPalette`。
 * 缺失时组件 effect 里会抛 `TypeError: panel.showModal is not a function`，
 * 异常发生在 effect 中会**中断整棵树的提交**，表现为「组件根本渲染不出来」，
 * 极易被误判为组件本身有 bug。集中在此 polyfill，避免每个 UI 测试各写一遍。
 */
/**
 * jsdom 未实现 `Element.prototype.scrollIntoView`。
 *
 * `TabRow`（激活标签自动滚入可视区）与虚拟列表都依赖它；缺失时会在 effect 中抛
 * `TypeError: ...scrollIntoView is not a function`，同样会中断整棵树的提交。
 * 测试环境没有真实布局，滚动本身不可验证，空实现即可。
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    // jsdom 无布局引擎，滚动无可观察效果：no-op
  };
}

if (typeof HTMLDialogElement !== 'undefined') {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

/**
 * jsdom 未实现 `IntersectionObserver`。
 *
 * `SettingsOutline`（设置页目录的滚动高亮）依赖它；缺失时会在 effect 中抛
 * `ReferenceError: IntersectionObserver is not defined`，与上面两例一样会
 * **中断整棵树的提交**（表现为设置页整体渲染不出来）。
 * 测试环境无真实布局与滚动，观察器只需存在且可注册/注销即可，不触发回调。
 */
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {
      // 测试环境无滚动，无需产生回调
    }
    unobserve(): void {
      // 同上
    }
    disconnect(): void {
      // 同上
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

/**
 * 开发期诊断输出在测试里只收集、不打印。
 *
 * `logDegraded` / `logFailure` 在 DEV 下写 console.warn / debug / error，而行为规格用例
 * 大量刻意模拟降级路径；逐条输出会把真实故障与其它工具告警淹没在重复文本里。诊断记录
 * 仍由 `platform/log.ts` 的 push() 写进环形缓冲，用例断言的是缓冲、toast 与状态，与终端
 * 输出无关，所以这里只收敛「打印」这一个出口，不改产品代码、断言与覆盖的行为路径。
 *
 * 收敛范围严格限定为 `[Tabs][` 前缀（本产品 console 输出的唯一格式）：React、Vitest、
 * 第三方依赖与性能基准的 console 输出原样放行；用例失败时回放本用例收集到的日志，
 * 保证失败现场仍可判定。
 */
const DIAGNOSTIC_LOG_PREFIX = '[Tabs][';
const capturedDiagnostics: string[] = [];
const passthroughConsole = {
  warn: console.warn.bind(console),
  debug: console.debug.bind(console),
  error: console.error.bind(console)
};

type ConsoleMethod = keyof typeof passthroughConsole;

function handleConsole(method: ConsoleMethod, args: unknown[]): void {
  const [first] = args;
  if (typeof first === 'string' && first.startsWith(DIAGNOSTIC_LOG_PREFIX)) {
    capturedDiagnostics.push(
      args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ')
    );
    return;
  }
  passthroughConsole[method](...args);
}

console.warn = (...args: unknown[]) => handleConsole('warn', args);
console.debug = (...args: unknown[]) => handleConsole('debug', args);
console.error = (...args: unknown[]) => handleConsole('error', args);

beforeEach((ctx) => {
  capturedDiagnostics.length = 0;
  // 失败回调挂在用例上下文上才能在 setup 文件里注册：通过的用例保持输出干净，
  // 失败的用例仍能看到本用例触发过的降级记录。
  ctx.onTestFailed(() => {
    if (capturedDiagnostics.length === 0) return;
    passthroughConsole.error(`[测试诊断输出]\n${capturedDiagnostics.join('\n')}`);
  });
});
