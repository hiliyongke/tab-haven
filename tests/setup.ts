/**
 * 全局测试准备（vitest setupFiles）。
 *
 * 此前 `window.matchMedia` 的 polyfill 在多个测试文件里各写一遍（jsdom 未实现，
 * 而 ThemeApplier 依赖它）。集中到此处后，新写的 UI/stores 测试不必再复制粘贴，
 * 也不会因为漏写而在「单独跑通过、加一个用例就崩」上浪费时间。
 */

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
