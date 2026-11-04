import { fakeBrowser } from 'wxt/testing/fake-browser';

/** 重置 fake-browser 的全局状态。 */
export function resetFakeBrowser(): void {
  fakeBrowser.reset();
}
