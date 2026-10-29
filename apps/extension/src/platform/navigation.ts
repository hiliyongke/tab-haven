import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/** 导航类能力（打开设置页 / 在标签中打开 URL / 下载 JSON）。收敛到 platform，入口层不再触碰 chrome API。 */

/** 打开扩展设置页（独立标签页形态）。 */
export function openOptionsPage(): void {
  void browser.runtime.openOptionsPage().catch((error: unknown) => {
    logDegraded('navigation', '打开设置页失败', error);
  });
}

/** 在标签中打开 URL（浏览器内部页，如快捷键设置）。返回值仅表示调用被接受，不代表加载成功。 */
export async function openUrlInTab(url: string): Promise<void> {
  try {
    await browser.tabs.create({ url });
  } catch (error) {
    logDegraded('navigation', '打开标签失败', error);
  }
}

/** 打开扩展自带的关于页（能力总览）。路径需以 `/` 开头（WXT 入口路径类型约束）。 */
export function openAboutPage(): void {
  void openUrlInTab(browser.runtime.getURL('/about.html'));
}

/** 把 JSON 文本下载为本地文件。纯本地（Blob URL），不发起任何网络请求。 */
export function downloadJsonFile(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // 立即 revoke 会让部分浏览器来不及读取，下一轮事件循环再释放。
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 扩展版本号（关于页展示用）；读取失败返回空串而非抛错。 */
export function getExtensionVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch (error) {
    logDegraded('navigation', '读取扩展版本失败', error);
    return '';
  }
}
