import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 侧边栏能力收敛层。
 *
 * `sidePanel` 是可选 API（兼容变体与旧内核没有它），且设置页、预设面板都需要
 * 读取当前布局 / 主动打开面板。集中在此后可统一处理「API 不存在」的降级，
 * 入口层不必各写一遍可选链与 try/catch。
 */

export type SidePanelSide = 'left' | 'right' | 'unknown';

/** 读取侧边栏停靠方向；API 不存在或读取失败返回 unknown。 */
export async function getSidePanelSide(): Promise<SidePanelSide> {
  try {
    const layout = await browser.sidePanel?.getLayout?.();
    return layout?.side ?? 'unknown';
  } catch (error) {
    logDegraded('side-panel', '读取侧边栏布局失败', error);
    return 'unknown';
  }
}

/**
 * 在当前窗口打开侧边栏；API 不存在或失败时静默降级。
 *
 * 与 `entrypoints/background/shared.ts` 的同名能力分属两侧：SW 侧用
 * WINDOW_ID_CURRENT 免查询，页面侧需要显式取当前窗口 id。
 */
export async function openSidePanelInCurrentWindow(): Promise<void> {
  try {
    const win = await browser.windows.getCurrent().catch(() => undefined);
    if (win?.id === undefined) return;
    await browser.sidePanel?.open?.({ windowId: win.id });
  } catch (error) {
    logDegraded('side-panel', '打开侧边栏失败', error);
  }
}
