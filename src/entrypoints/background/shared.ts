import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import {
  PENDING_ACTIONS_KEY,
  PENDING_ACTIONS_LIMIT,
  PendingActionsSchema,
  sendMessage,
  type Message,
  type PendingAction
} from '@/platform/messages';
import { settingsRepository } from '@/platform/storage/repositories';
import { logDegraded } from '@/platform/diagnostics';

/**
 * SW 侧共享状态与工具（被各 background 子模块复用）。
 * 拆分自原 background.ts：设置缓存 / hostname 工具 / 白名单 / 通知 / 待执行动作队列 / 打开侧栏。
 */

/** SW 侧设置缓存：SW 每次启动重新读取（模块级变量在回收后重置），变更经 watch 实时更新。 */
export let cachedSettings: Settings = DEFAULT_SETTINGS;
export const syncCachedSettings = async (): Promise<void> => {
  try {
    cachedSettings = await settingsRepository.read();
  } catch (error) {
    logDegraded('background', '共享上下文读取失败', error);
    // 读取失败保持默认值，后续 watch 会自动纠正
  }
};

/** 提取 hostname（失败返回空串）。 */
export function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch (error) {
    logDegraded('background', '共享上下文读取失败', error);
    return '';
  }
}

/** 域名白名单匹配：精确 hostname 或子域匹配（qq.com 覆盖 mail.qq.com）。 */
export function isWhitelisted(hostname: string, whitelist: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return whitelist.some((entry) => {
    const target = entry
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
    if (!target) return false;
    return host === target || host.endsWith(`.${target}`);
  });
}

/** 通知用户（notifications 权限不可用时静默）。 */
export function notifyUser(title: string, message: string): void {
  if (!browser.notifications?.create) return;
  browser.notifications
    .create('tabs-action', {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title,
      message,
      priority: 1
    })
    .catch(() => {});
}

/**
 * 把待面板执行的动作存入 storage.session（面板未开时挂起），并即时广播。
 *
 * 双通道是刻意为之：打开侧边栏后立刻 `runtime.sendMessage` 存在竞态——
 * 面板文档可能尚未注册监听，消息无人接收，用户看到「按了快捷键没反应」。
 * 落一份到 session 队列后，面板挂载时补消费，动作不会丢。
 */
/**
 * 挂起动作的类型取自 `@/platform/messages` 的协议 schema，不在此处另抄一份——
 * 此前这里有一个手工维护的 `PendingActionMessage` 结构类型，与协议 schema 毫无关联，
 * 改协议时极易漏改，且漏改只表现为「动作静默不执行」。
 */
type PendingActionInput =
  { type: 'search-domain'; query: string } | { type: 'locate-active' } | { type: 'focus-search' };

export async function queueAction(action: PendingActionInput): Promise<void> {
  // at 时间戳：面板经「即时消息 + session onChanged」双通道收到同一动作时按 at 去重，
  // 且面板消费后清除 session 列表，不会重放历史动作。
  const at = Date.now();
  const stamped = { ...action, at } as PendingAction;
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const existing = await sessionArea.get(PENDING_ACTIONS_KEY);
      // 存的是外部数据，必须经 schema 校验：手写的 `as PendingAction[]` 断言
      // 会把任何形状的垃圾都当成合法队列。
      const parsed = PendingActionsSchema.safeParse(existing[PENDING_ACTIONS_KEY]);
      const list: PendingAction[] = parsed.success ? [...parsed.data] : [];
      list.push(stamped);
      await sessionArea.set({ [PENDING_ACTIONS_KEY]: list.slice(-PENDING_ACTIONS_LIMIT) });
    }
  } catch (error) {
    logDegraded('background', '共享上下文操作失败', error);
    // session 存储不可用时仅即时广播
  }
  sendMessage(stamped as Message);
}

/**
 * 打开（或聚焦）当前窗口的侧边栏。
 *
 * 关键约束：sidePanel.open 必须在用户手势回调的同步栈内调用 ——
 * 此前先 await browser.tabs.query(...) 再 open，手势令牌在 await 后已被
 * Chrome 消费，open 以「user gesture is required」拒绝，而错误被
 * .catch(() => {}) 静默吞掉，表现为「右键菜单点『打开面板』没反应」。
 * 现在 windowId 直接用 WINDOW_ID_CURRENT（免预查询），失败降级为
 * lastFocusedWindow 二次尝试；所有失败都记入诊断，不再静默。
 */
export async function openSidePanel(): Promise<void> {
  const sidePanel = browser.sidePanel;
  if (!sidePanel?.open) {
    // Chrome < 116 无 open()：面板只能从 Chrome 侧边栏入口手动打开。
    logDegraded('background', '当前浏览器不支持 sidePanel.open（需 Chrome 116+）');
    return;
  }
  try {
    await sidePanel.open({ windowId: browser.windows.WINDOW_ID_CURRENT });
    return;
  } catch {
    // WINDOW_ID_CURRENT 不被接受（罕见）：降级为 lastFocusedWindow 再试一次。
  }
  try {
    const win = await browser.windows.getLastFocused();
    if (win?.id !== undefined) await sidePanel.open({ windowId: win.id });
  } catch (error) {
    logDegraded('background', '打开侧边栏失败', error);
  }
}
