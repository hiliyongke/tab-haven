import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 导航类能力（打开设置页 / 在标签中打开 URL）。
 *
 * 收敛到 platform 的原因：`browser.runtime.openOptionsPage` 与
 * `browser.tabs.create({ url })` 此前散落在 sidepanel / popup / options 三个入口
 * 共 5 处，其中「打开设置页」还被原样复制了两遍。集中后入口层不再触碰 chrome API，
 * 也消除了重复的降级处理。
 */

/** 打开扩展设置页（独立标签页形态）。 */
export function openOptionsPage(): void {
  void browser.runtime.openOptionsPage().catch((error: unknown) => {
    logDegraded('navigation', '打开设置页失败', error);
  });
}

/**
 * 在标签中打开 URL（用于浏览器内部页，如快捷键设置）。
 *
 * 返回值仅表示调用是否被接受，不代表页面一定加载成功。
 */
export async function openUrlInTab(url: string): Promise<void> {
  try {
    await browser.tabs.create({ url });
  } catch (error) {
    logDegraded('navigation', '打开标签失败', error);
  }
}
