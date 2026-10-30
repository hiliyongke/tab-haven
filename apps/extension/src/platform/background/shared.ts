import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import { hostnameOf as coreHostnameOf, inspectUrl } from '@/core/url/UrlInspector';
import { createSerialChain } from '@/core/util/concurrency';
import { newId } from '@/core/util/id';
import { normalizeWhitelistHost } from '@/core/url/hostname';
import {
  PENDING_ACTIONS_KEY,
  PENDING_ACTIONS_LIMIT,
  PendingActionsSchema,
  sendMessage,
  type Message,
  type PendingAction
} from '@/platform/messages';
import { settingsRepository } from '@/platform/storage/repositories';
import { PENDING_ACTIONS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { logDegraded } from '@/platform/diagnostics';
import { openSidePanel } from '@/platform/sidePanel';

/**
 * SW 侧共享状态与工具（被各 background 子模块复用）：
 * 设置缓存 / hostname 留痕包装 / 白名单 / 通知 / 待执行动作队列。
 * 打开侧边栏属 platform/sidePanel，不在此处另写一份。
 */

/**
 * SW 侧设置缓存：SW 每次启动重新读取，变更经 watch 实时更新。与「直接 settingsRepository.read()」
 * 是两条刻意并存的读取口径：
 *  - 缓存：SW 已唤醒、watch 已生效后的高频路径（休眠扫描、角标、右键菜单），读一次磁盘换一轮 IPC；
 *  - 仓库直读：SW 刚被唤醒、watch 尚未生效的窗口期，此时缓存仍是 DEFAULT_SETTINGS，用它判开关会跳过功能。
 * 选哪条只取决于「此刻 watch 是否已生效」。export let 不会造成外部可写：ESM 导入绑定对导入方只读。
 */
export let cachedSettings: Settings = DEFAULT_SETTINGS;
export const syncCachedSettings = async (): Promise<void> => {
  try {
    cachedSettings = await settingsRepository.read();
  } catch (error) {
    // 文案须与函数名对应：此处是「设置缓存读取」，不是泛化的共享上下文操作。
    logDegraded('background', '设置缓存读取失败，保持当前缓存值（后续 watch 会纠正）', error);
  }
};

/**
 * hostname 判定的唯一事实来源在 @/core/url/UrlInspector，这里只包一层 SW 侧留痕。
 * 各写一份判定时，任一处修口径另一处都静默漏改。
 */
export const hostnameOf = (url: string | undefined): string | undefined => {
  const host = coreHostnameOf(url);
  // 「有 URL 却取不到主机名」在 SW 侧是用户可见降级：白名单按主机名匹配，取不到即不命中。
  // 空白起始页（about:blank 等）本就没有主机名，属正常态，不记诊断。
  if (url && !host && inspectUrl(url, undefined).category !== 'blank-start') {
    logDegraded('background', 'URL 无法解析为主机名，已按无主机名处理', url);
  }
  return host;
};

/**
 * 构建白名单匹配器（精确 hostname 或子域匹配，qq.com 覆盖 mail.qq.com）。归一化只做一次，
 * 自动休眠每轮要过「全部标签 × 全部白名单」，预归一化后内层只剩字符串比较。
 */
export function buildWhitelistMatcher(whitelist: readonly string[]): (hostname: string) => boolean {
  // 归一化委托 core/url/hostname 的唯一来源（schema 层落盘时用同一函数）。
  const targets: string[] = [];
  for (const entry of whitelist) {
    const target = normalizeWhitelistHost(entry);
    if (target) targets.push(target);
  }
  return (hostname: string) => {
    const host = hostname.toLowerCase();
    return targets.some((target) => host === target || host.endsWith(`.${target}`));
  };
}

/**
 * 通知用途。Chrome 对同名 id 的通知是替换而非排队：固定 id 下自动休眠的「已休眠 N 个标签
 * （可一键唤醒）」会被紧随的「保存失败」顶掉。按用途分 id 后两条通知各占一个槽位。
 */
export type NotifyPurpose = 'auto-discard' | 'action';

const NOTIFICATION_IDS: Record<NotifyPurpose, string> = {
  'auto-discard': 'tabs-auto-discard',
  action: 'tabs-action'
};

/** 通知用户（notifications 权限不可用时静默）。 */
export function notifyUser(
  title: string,
  message: string,
  purpose: NotifyPurpose = 'action'
): void {
  if (!browser.notifications?.create) return;
  browser.notifications
    .create(NOTIFICATION_IDS[purpose], {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title,
      message,
      priority: 1
    })
    .catch(() => {});
}

/** 挂起动作的类型取自 @/platform/messages 的协议 schema，不在此处另抄一份
 *  （另抄的结构类型与协议毫无关联，改协议时漏改只表现为「动作静默不执行」）。 */
type PendingActionInput =
  { type: 'search-domain'; query: string } | { type: 'locate-active' } | { type: 'focus-search' };

/** 挂起队列 read-modify-write 串行链：连续两个动作（快捷键连按）的 get→set
 *  交错会静默丢掉先入队的那一条。 */
const queueActionChain = createSerialChain();

/**
 * 把待面板执行的动作存入 storage.session（面板未开时挂起），并即时广播。双通道是刻意为之：
 * 打开侧边栏后立刻 sendMessage 存在竞态——面板文档可能尚未注册监听，消息无人接收。
 * 落一份到 session 队列后，面板挂载时补消费，动作不会丢。
 */
export async function queueAction(action: PendingActionInput): Promise<void> {
  // 双通道通过独立 id 去重；时间戳只表示动作发生时间。
  const stamped = { ...action, actionId: newId('action'), at: Date.now() };
  // 链尾统一兜底：任何一次漏网 reject 都会让此后每个 queueAction 永不 resolve，
  // 快捷键路径表现为「按了没反应」且无任何报错。
  await queueActionChain.enqueueSettled(
    () =>
      withCrossPageLock(PENDING_ACTIONS_RMW_LOCK, async () => {
        const sessionArea = browser.storage?.session;
        if (!sessionArea) return;
        const existing = await sessionArea.get(PENDING_ACTIONS_KEY);
        // 存的是外部数据，必须经 schema 校验：手写的 as 断言会把任何形状的垃圾都当成合法队列。
        const parsed = PendingActionsSchema.safeParse(existing[PENDING_ACTIONS_KEY]);
        const list: PendingAction[] = parsed.success ? [...parsed.data] : [];
        list.push(stamped);
        await sessionArea.set({ [PENDING_ACTIONS_KEY]: list.slice(-PENDING_ACTIONS_LIMIT) });
      }),
    (error) =>
      // 文案须与函数名对应：此处是「挂起动作入队」，不是泛化的共享上下文操作。
      logDegraded('background', '挂起动作入队失败（session 不可用时仅即时广播）', error)
  );
  sendMessage(stamped as Message);
}

/**
 * 面板侧搜索：先开面板，再把搜索动作挂起投递。右键菜单与地址栏共用这一条路径：
 * 只入队不开面板时，面板未打开则动作仅落 session 队列，用户点了「搜索此域名」得到零反馈。
 */
export async function runPanelSearch(query: string): Promise<void> {
  await openSidePanel().catch(() => undefined);
  await queueAction({ type: 'search-domain', query });
}
