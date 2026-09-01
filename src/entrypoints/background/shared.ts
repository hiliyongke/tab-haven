import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import { PENDING_ACTIONS_KEY } from '@/platform/messages';
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
    .create('tabhaven-action', {
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
type PendingAction =
  | { type: 'search-domain'; query: string; at: number }
  | { type: 'locate-active'; at: number }
  | { type: 'focus-search'; at: number };

type PendingActionInput =
  | { type: 'search-domain'; query: string }
  | { type: 'locate-active' }
  | { type: 'focus-search' };

interface PendingActionMessage {
  type: 'search-domain' | 'locate-active' | 'focus-search';
  query?: string;
  at: number;
}

export async function queueAction(action: PendingActionInput): Promise<void> {
  // at 时间戳：面板经「即时消息 + session onChanged」双通道收到同一动作时按 at 去重，
  // 且面板消费后清除 session 列表，不会重放历史动作。
  const at = Date.now();
  const stamped: PendingAction = { ...action, at } as PendingAction;
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const existing = await sessionArea.get(PENDING_ACTIONS_KEY);
      const list: PendingAction[] = Array.isArray(existing[PENDING_ACTIONS_KEY])
        ? (existing[PENDING_ACTIONS_KEY] as PendingAction[])
        : [];
      list.push(stamped);
      await sessionArea.set({ [PENDING_ACTIONS_KEY]: list.slice(-5) });
    }
  } catch (error) {
    logDegraded('background', '共享上下文操作失败', error);
    // session 存储不可用时仅即时广播
  }
  const message: PendingActionMessage = { type: stamped.type, at: stamped.at };
  if (stamped.type === 'search-domain') message.query = stamped.query;
  browser.runtime.sendMessage(message).catch(() => {});
}

/** 打开（或聚焦）当前窗口的侧边栏。 */
export async function openSidePanel(): Promise<void> {
  if (!browser.sidePanel?.open) return;
  const [tab] = await browser.tabs.query({ currentWindow: true, active: true });
  if (tab?.windowId !== undefined) {
    await browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
}
