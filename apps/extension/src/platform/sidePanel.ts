import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 侧边栏能力收敛层：`sidePanel` 属能力探测范畴（个别内核/浏览器没有它），设置页与预设面板都要读布局 / 主动打开。
 * 集中后可统一处理「API 不存在」的降级，入口层不必各写一遍可选链与 try/catch。
 * 注：这是运行环境能力探测，不是版本兼容逻辑。
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
 * 打开（或聚焦）侧边栏；API 不存在或失败时记入诊断并降级。
 *
 * 不传 windowId 时先用 `WINDOW_ID_CURRENT` 直接 open：SW 侧必须在用户手势的同步栈内调用 open，
 * 任何前置 await 都会消耗手势令牌，open 会被「user gesture is required」拒绝。
 * 不接受时再按「当前窗口 → 最近聚焦窗口」依次取真实 id 重试。
 */
export async function openSidePanel(windowId?: number): Promise<void> {
  const sidePanel = browser.sidePanel;
  if (!sidePanel?.open) {
    // 无 open() 时（能力探测：个别内核未实现该方法）只能由用户从浏览器侧边栏入口打开。
    logDegraded('side-panel', '当前浏览器不支持 sidePanel.open，已降级为不主动打开');
    return;
  }
  try {
    await sidePanel.open({ windowId: windowId ?? browser.windows.WINDOW_ID_CURRENT });
    return;
  } catch {
    // WINDOW_ID_CURRENT 不被接受（罕见）：按真实窗口 id 再试。
  }
  const win =
    (await browser.windows.getCurrent().catch(() => undefined)) ??
    (await browser.windows.getLastFocused().catch(() => undefined));
  if (win?.id === undefined) {
    logDegraded('side-panel', '无法确定目标窗口，已放弃打开侧边栏');
    return;
  }
  try {
    await sidePanel.open({ windowId: win.id });
  } catch (error) {
    logDegraded('side-panel', '打开侧边栏失败', error);
  }
}

/**
 * 对齐「点击工具栏图标」的行为：true = 打开侧边栏，false = 不弹面板（由 SW 在 onClicked 里后台整理标签）。
 * `setPanelBehavior` 不跨浏览器会话持久，SW 每次唤醒/设置变更都要对齐一次；
 * 收敛到此处让入口层不再直接触碰 `browser.sidePanel`，也让该行为可被单测驱动。
 */
export async function setActionClickBehavior(openPanelOnActionClick: boolean): Promise<void> {
  if (!browser.sidePanel?.setPanelBehavior) return;
  try {
    await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick });
  } catch (error) {
    logDegraded('side-panel', '对齐工具栏点击行为失败', error);
  }
}
