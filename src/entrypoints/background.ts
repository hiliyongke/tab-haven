import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { dedupePins, createFolderItem, pinFromTab } from '@/core/fixed/FolderOps';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { FixedFolder, Settings, SnapshotTab } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { mapTab } from '@/platform/tabs';
import { readSession } from '@/platform/storage/session';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
import {
  autoDiscardRepository,
  foldersRepository,
  pinsRepository,
  settingsRepository
} from '@/platform/storage/repositories';
import {
  AllowDuplicateOnceMessageSchema,
  AutoDiscardedMessageSchema,
  DuplicateReusedMessageSchema,
  LocateActiveMessageSchema,
  PENDING_ACTIONS_KEY,
  SearchDomainMessageSchema,
  SearchFocusMessageSchema,
  SettingsSyncedMessageSchema,
  SkipAutoSaveOnceMessageSchema
} from '@/platform/messages';
import { createTabsWithUrls } from '@/platform/tabs';
import { buildSnapshot, persistSnapshot } from '@/platform/snapshot/snapshots';

/**
 * Service Worker 入口。
 *
 * 职责：
 *  - 把 tabs 生命周期事件接入 ReuseCoordinator（重复标签自动复用）；
 *  - 处理 UI 的豁免授权请求（allow-duplicate-once）；
 *  - 点击图标打开侧边栏（sidePanel 形态）；
 *  - 浏览器级快捷键命令分发（聚焦搜索 / 开面板 / 定位激活 / 休眠非激活）；
 *  - contextMenus 右键体系（页面 / 链接 / 标签栏 / 工具栏图标）；
 *  - omnibox 地址栏命令（th <关键词>）；
 *  - action badge 角标（标签数 / 重复组数 / 休眠数）；
 *  - 自动休眠（白名单 + 台账 + 通知，可撤销）。
 */

/**
 * SW 侧设置缓存：SW 每次启动重新读取（模块级变量在回收后重置），
 * 变更经 settingsRepository.watch 实时更新，避免事件路径反复读 storage。
 */
let cachedSettings: Settings = DEFAULT_SETTINGS;
const syncCachedSettings = async (): Promise<void> => {
  try {
    cachedSettings = await settingsRepository.read();
  } catch {
    // 读取失败保持默认值，后续 watch 会自动纠正
  }
};

/** 提取 hostname（失败返回空串）。 */
function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** 域名白名单匹配：精确 hostname 或子域匹配（qq.com 覆盖 mail.qq.com）。 */
function isWhitelisted(hostname: string, whitelist: readonly string[]): boolean {
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
function notifyUser(title: string, message: string): void {
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

/** 把待面板执行的动作存入 storage.session（面板未开时挂起），并即时广播。 */
type PendingAction =
  | { type: 'search-domain'; query: string; at: number }
  | { type: 'locate-active'; at: number };
type PendingActionInput = { type: 'search-domain'; query: string } | { type: 'locate-active' };

async function queueAction(action: PendingActionInput): Promise<void> {
  // at 时间戳：面板经「即时消息 + session onChanged」双通道收到同一动作时按 at 去重，
  // 且面板消费后清除 session 列表，不会重放历史动作。
  const at = Date.now();
  const stamped: PendingAction =
    action.type === 'search-domain'
      ? { type: 'search-domain', query: action.query, at }
      : { type: 'locate-active', at };
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
  } catch {
    // session 存储不可用时仅即时广播
  }
  const message =
    stamped.type === 'search-domain'
      ? SearchDomainMessageSchema.parse({ type: 'search-domain', query: stamped.query, at: stamped.at })
      : LocateActiveMessageSchema.parse({ type: 'locate-active', at: stamped.at });
  browser.runtime.sendMessage(message).catch(() => {});
}

/** 打开（或聚焦）当前窗口的侧边栏。 */
async function openSidePanel(): Promise<void> {
  if (!browser.sidePanel?.open) return;
  const [tab] = await browser.tabs.query({ currentWindow: true, active: true });
  if (tab?.windowId !== undefined) {
    await browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// contextMenus 右键体系
// ---------------------------------------------------------------------------

const MENU_IDS = {
  pageDiscard: 'th:page:discard',
  pagePin: 'th:page:pin',
  pageSearchSite: 'th:page:search-site',
  pageFolderParent: 'th:page:folder-parent',
  linkFolderParent: 'th:link:folder-parent',
  tabDiscard: 'th:tab:discard',
  tabSearchSite: 'th:tab:search-site',
  actionOpenPanel: 'th:action:open-panel',
  actionDiscardInactive: 'th:action:discard-inactive',
  actionSettings: 'th:action:settings'
} as const;

/** contextMenus 标题的 i18n 消息键（与 _locales 一一对应）。 */
type MenuMessageKey =
  | 'menuDiscardPage'
  | 'menuPinPage'
  | 'menuSearchSite'
  | 'menuAddPageToFolder'
  | 'menuAddLinkToFolder'
  | 'menuDiscardTab'
  | 'menuOpenPanel'
  | 'menuDiscardInactive'
  | 'menuOpenSettings';

// getMessage 缺失时返回空串而非 null/undefined，须用 || 兜底。
const menuText = (key: MenuMessageKey): string => browser.i18n.getMessage(key) || key;

/**
 * 菜单写操作串行队列：rebuild/removeAll 可由 folders watch、settings watch、
 * setupMenus 并发触发，removeAll 与 create 交错会产生重复 id 的 rejection，
 * 全部菜单写操作经此队列串行执行；单次失败只告警不阻塞后续。
 */
let menuWriteChain: Promise<void> = Promise.resolve();

function enqueueMenuWrite(task: () => Promise<void>): void {
  menuWriteChain = menuWriteChain.then(() =>
    task().catch((error) => console.warn('[contextMenus] write failed', error))
  );
}

/** 清空右键菜单（串行）。 */
function clearContextMenus(): void {
  const menus = browser.contextMenus;
  if (!menus) return;
  enqueueMenuWrite(() => menus.removeAll());
}

/** 重建右键菜单（文件夹列表变化时刷新子菜单；串行，先清后建）。 */
function rebuildContextMenus(folders: readonly FixedFolder[]): void {
  const menus = browser.contextMenus;
  if (!menus) return;
  enqueueMenuWrite(async () => {
    await menus.removeAll();
    // 页面右键
    await menus.create({ id: MENU_IDS.pageDiscard, title: menuText('menuDiscardPage'), contexts: ['page'] });
    await menus.create({ id: MENU_IDS.pagePin, title: menuText('menuPinPage'), contexts: ['page'] });
    await menus.create({ id: MENU_IDS.pageSearchSite, title: menuText('menuSearchSite'), contexts: ['page'] });
    if (folders.length > 0) {
      await menus.create({ id: MENU_IDS.pageFolderParent, title: menuText('menuAddPageToFolder'), contexts: ['page'] });
      for (const folder of folders) {
        await menus.create({
          id: `th:page:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.pageFolderParent,
          contexts: ['page']
        });
      }
    }
    // 链接右键
    if (folders.length > 0) {
      await menus.create({ id: MENU_IDS.linkFolderParent, title: menuText('menuAddLinkToFolder'), contexts: ['link'] });
      for (const folder of folders) {
        await menus.create({
          id: `th:link:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.linkFolderParent,
          contexts: ['link']
        });
      }
    }
    // 标签栏右键
    await menus.create({ id: MENU_IDS.tabDiscard, title: menuText('menuDiscardTab'), contexts: ['tab'] });
    await menus.create({ id: MENU_IDS.tabSearchSite, title: menuText('menuSearchSite'), contexts: ['tab'] });
    // 工具栏图标右键
    await menus.create({ id: MENU_IDS.actionOpenPanel, title: menuText('menuOpenPanel'), contexts: ['action'] });
    await menus.create({ id: MENU_IDS.actionDiscardInactive, title: menuText('menuDiscardInactive'), contexts: ['action'] });
    await menus.create({ id: MENU_IDS.actionSettings, title: menuText('menuOpenSettings'), contexts: ['action'] });
  });
}

/** 把单个条目加入固定文件夹（URL 全局唯一；绑定由面板 reconcile 自动建立）。 */
async function addEntryToFolder(
  folderId: string,
  entry: { url: string; title: string; favIconUrl?: string }
): Promise<boolean> {
  const folders = await foldersRepository.read();
  const target = folders.find((folder) => folder.id === folderId);
  if (!target) return false;
  const key = webComparisonKey(entry.url, undefined) ?? entry.url;
  const exists = folders.some((folder) =>
    folder.items.some((item) => (webComparisonKey(item.url, undefined) ?? item.url) === key)
  );
  if (exists) return false;
  const item = createFolderItem({ url: key, title: entry.title, favIconUrl: entry.favIconUrl });
  const next = folders.map((folder) =>
    folder.id === folderId ? { ...folder, collapsed: false, items: [...folder.items, item] } : folder
  );
  await foldersRepository.write(next);
  return true;
}

/** 休眠单个标签（带安全判定与结果通知）。 */
async function discardTabSafely(rawTab: Parameters<typeof mapTab>[0] | undefined): Promise<boolean> {
  if (!rawTab || rawTab.id === undefined) return false;
  const tab = mapTab(rawTab);
  if (!canSafelyDiscardTab(tab)) {
    notifyUser('TabHaven', 'This tab cannot be discarded right now.');
    return false;
  }
  const ok = await browser.tabs.discard(tab.id).then(() => true).catch(() => false);
  if (ok) notifyUser('TabHaven', 'Tab discarded.');
  return ok;
}

// ---------------------------------------------------------------------------
// 自动休眠：白名单 + 台账 + 通知（可撤销）
// ---------------------------------------------------------------------------

async function recordAutoDiscardBatch(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  await autoDiscardRepository.write({ tabIds, at: Date.now(), count: tabIds.length });
  if (cachedSettings.discardNotifyEnabled) {
    notifyUser('TabHaven', `Discarded ${tabIds.length} tabs (undo in panel).`);
  }
  const message = AutoDiscardedMessageSchema.parse({
    type: 'auto-discarded',
    tabIds,
    count: tabIds.length,
    at: Date.now()
  });
  browser.runtime.sendMessage(message).catch(() => {});
}

/** 清理已失效的自动休眠台账（批次标签全部不存在或已唤醒）。 */
async function pruneAutoDiscardBatch(): Promise<void> {
  try {
    const batch = await autoDiscardRepository.read();
    if (!batch) return;
    const tabs = await browser.tabs.query({});
    const live = new Map(tabs.map((tab) => [tab.id, tab.discarded]));
    const anyStillDiscarded = batch.tabIds.some((id) => live.get(id) === true);
    if (!anyStillDiscarded) await autoDiscardRepository.write(null);
  } catch {
    // 读取失败保持现状
  }
}

/** 自动休眠一轮：白名单 + 安全判定 + 台账。 */
const runAutoDiscard = async (): Promise<void> => {
  try {
    const settings = await settingsRepository.read();
    if (!settings.autoDiscardEnabled) return;
    const [tabs, session] = await Promise.all([
      browser.tabs.query({ windowType: 'normal' }),
      readSession()
    ]);
    const boundTabIds = new Set(Object.values(session.itemTabBindings));
    const whitelist = settings.discardWhitelist;
    const cutoff = Date.now() - settings.autoDiscardMinutes * 60_000;
    const discardedIds: number[] = [];
    for (const rawTab of tabs) {
      const tab = mapTab(rawTab);
      if (
        tab.id < 0 ||
        boundTabIds.has(tab.id) ||
        typeof tab.lastAccessed !== 'number' ||
        !canSafelyDiscardTab(tab) ||
        tab.lastAccessed >= cutoff
      ) {
        continue;
      }
      const host = hostnameOf(tab.url);
      if (host && isWhitelisted(host, whitelist)) continue;
      const ok = await browser.tabs.discard(tab.id).then(() => true).catch(() => false);
      if (ok) discardedIds.push(tab.id);
    }
    if (discardedIds.length > 0) await recordAutoDiscardBatch(discardedIds);
    await pruneAutoDiscardBatch();
  } catch {
    // 忽略：下次闹钟自动重试
  }
};

/** 按设置创建/清除自动休眠闹钟：关闭时不保留闹钟，避免每分钟空跑唤醒 SW。 */
async function syncAutoDiscardAlarm(settings: Settings): Promise<void> {
  try {
    if (settings.autoDiscardEnabled) {
      // periodInMinutes 最小为 1；同名闹钟重复创建即重置，幂等安全。
      await browser.alarms.create('tabhaven-auto-discard', { periodInMinutes: 1 });
    } else {
      await browser.alarms.clear('tabhaven-auto-discard');
    }
  } catch {
    // alarms 不可用时忽略
  }
}

/** 休眠当前窗口全部非激活、可安全丢弃的标签（含台账与通知）。 */
async function discardInactiveTabs(): Promise<void> {
  const [tabs, session] = await Promise.all([
    browser.tabs.query({ currentWindow: true }),
    readSession()
  ]);
  // 与 runAutoDiscard / 面板 UI 同一安全集：固定空间绑定的标签永不休眠。
  const boundTabIds = new Set(Object.values(session.itemTabBindings));
  const targets: number[] = [];
  for (const rawTab of tabs) {
    const tab = mapTab(rawTab);
    if (tab.id >= 0 && !boundTabIds.has(tab.id) && canSafelyDiscardTab(tab)) targets.push(tab.id);
  }
  const discardedIds: number[] = [];
  for (const tabId of targets) {
    const ok = await browser.tabs.discard(tabId).then(() => true).catch(() => false);
    if (ok) discardedIds.push(tabId);
  }
  if (discardedIds.length === 0) return;
  await recordAutoDiscardBatch(discardedIds);
}

// ---------------------------------------------------------------------------
// action badge 角标（标签数 / 重复组数 / 休眠数）
// ---------------------------------------------------------------------------

let badgeTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshBadge(): Promise<void> {
  if (!browser.action) return;
  try {
    const tabs = await browser.tabs.query({ windowType: 'normal' });
    const total = tabs.length;
    const dupGroups = new Set<string>();
    const seen = new Set<string>();
    for (const tab of tabs) {
      // 与全应用统一的 webComparisonKey 归一化口径（导航中取 pendingUrl，非 web 页跳过），
      // 保证角标重复组数与面板统计一致。
      const key = webComparisonKey(tab.url, tab.pendingUrl);
      if (!key) continue;
      if (seen.has(key)) dupGroups.add(key);
      seen.add(key);
    }
    const discarded = tabs.filter((tab) => tab.discarded).length;
    const mode = cachedSettings.badgeMode;
    if (mode === 'off') {
      await browser.action.setBadgeText({ text: '' });
    } else {
      const dupCount = dupGroups.size;
      let text = '';
      let color = '#6366f1';
      if (mode === 'dups') {
        text = dupCount > 0 ? String(Math.min(dupCount, 999)) : '';
        color = '#dc2626';
      } else if (mode === 'count') {
        text = total > 0 ? String(Math.min(total, 999)) : '';
      } else if (dupCount > 0) {
        // auto：有重复时优先展示重复组数（警示），否则展示标签总数
        text = String(Math.min(dupCount, 999));
        color = '#dc2626';
      } else {
        text = total > 0 ? String(Math.min(total, 999)) : '';
      }
      await browser.action.setBadgeText({ text });
      await browser.action.setBadgeBackgroundColor({ color });
    }
    await browser.action.setTitle({
      title: `${total} tabs · ${dupGroups.size} dup groups · ${discarded} discarded`
    });
  } catch {
    // badge 不可用时静默（不阻塞其他功能）
  }
}

function refreshBadgeSoon(): void {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = undefined;
    void refreshBadge();
  }, 500);
}

// ---------------------------------------------------------------------------
// omnibox 地址栏命令（th <关键词>）
// ---------------------------------------------------------------------------

/** omnibox 建议项（与 chrome.omnibox.SuggestResult 结构兼容）。 */
interface OmniSuggestion {
  content: string;
  description: string;
}

async function queryOmnibox(text: string): Promise<OmniSuggestion[]> {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const [tabs, folders, pins] = await Promise.all([
    browser.tabs.query({ windowType: 'normal' }),
    foldersRepository.read(),
    pinsRepository.read()
  ]);
  const suggestions: OmniSuggestion[] = [];
  // omnibox description 是受限 XML（<match>/<url>/<dim>），特殊字符必须转义。
  const escapeXml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const push = (content: string, title: string, subtitle: string): void => {
    if (suggestions.length >= 12) return;
    suggestions.push({
      content,
      description: `<match>${escapeXml(title)}</match> <url>${escapeXml(subtitle)}</url>`
    });
  };

  const matches = (haystack: string | undefined): boolean =>
    Boolean(haystack?.toLowerCase().includes(q));

  for (const tab of tabs) {
    if (matches(tab.title) || matches(tab.url)) {
      push(`tab:${tab.id}`, tab.title || '(untitled)', hostnameOf(tab.url) || 'tab');
    }
  }
  for (const pin of pins) {
    if (matches(pin.title) || matches(pin.url)) {
      push(`pin:${pin.id}`, `Pin ${pin.title}`, hostnameOf(pin.url) || 'pin');
    }
  }
  for (const folder of folders) {
    if (matches(folder.name)) {
      push(`folder:${folder.id}`, `Folder ${folder.name}`, `${folder.items.length} items`);
    }
    for (const item of folder.items) {
      if (matches(item.title) || matches(item.url)) {
        push(`item:${folder.id}:${item.id}`, item.title, `${folder.name} · ${hostnameOf(item.url)}`);
      }
    }
  }
  return suggestions.slice(0, 12);
}

async function handleOmniboxEnter(content: string): Promise<void> {
  if (content.startsWith('tab:')) {
    const tabId = Number(content.slice(4));
    if (Number.isInteger(tabId)) {
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      if (tab) {
        await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
        await browser.tabs.update(tab.id, { active: true }).catch(() => {});
      }
    }
    return;
  }
  if (content.startsWith('pin:')) {
    const pinId = content.slice(4);
    const pins = await pinsRepository.read();
    const pin = pins.find((p) => p.id === pinId);
    if (pin) {
      await browser.tabs.create({ url: pin.url, active: true }).catch(() => {});
    }
    return;
  }
  if (content.startsWith('item:')) {
    const [, folderId, itemId] = content.split(':');
    const folders = await foldersRepository.read();
    const item = folders.find((f) => f.id === folderId)?.items.find((i) => i.id === itemId);
    if (item) await browser.tabs.create({ url: item.url, active: true }).catch(() => {});
    return;
  }
  if (content.startsWith('folder:')) {
    const folderId = content.slice(7);
    const folders = await foldersRepository.read();
    const folder = folders.find((f) => f.id === folderId);
    if (folder) {
      const urls = folder.items.map((item) => item.url).filter(Boolean);
      await createTabsWithUrls(urls);
    }
  }
}

// ---------------------------------------------------------------------------
// 关窗自动保存（D5.2）：窗口关闭时自动存为快照（画像二生死线兜底）。
// windows.onRemoved 触发时标签已不可查询，故用 storage.session 持续缓存每个
// 窗口的轻量标签列表；SW 重启后仍可从 session 恢复，关窗时取缓存落盘。
// ---------------------------------------------------------------------------

const WINDOW_TABS_KEY = 'tabhaven.window-tabs.v1';
type WindowTabsCache = Record<string, SnapshotTab[]>;
let memWindowTabs: WindowTabsCache = {};
let windowTabsFlushTimer: ReturnType<typeof setTimeout> | undefined;
const windowRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** 下一次关闭时跳过自动保存的窗口（归档流程已自行留档，防重复快照）。 */
const skipAutoSaveWindowIds = new Set<number>();

/** 把内存缓存刷入 storage.session（防 SW 回收后丢失）。 */
function flushWindowTabs(): void {
  windowTabsFlushTimer = undefined;
  const sessionArea = browser.storage?.session;
  if (!sessionArea) return;
  void sessionArea.set({ [WINDOW_TABS_KEY]: memWindowTabs }).catch(() => {});
}

/** 原始标签 → 轻量快照条目（仅 http(s) 页面可恢复，其余跳过）。 */
function snapshotTabOf(raw: Parameters<typeof mapTab>[0] | undefined): SnapshotTab | null {
  if (!raw) return null;
  const tab = mapTab(raw);
  // chrome:// / about: 等内部页无法以 URL 重新创建，收入快照只会成为死条目。
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) return null;
  return { url: tab.url, title: tab.title || '', favIconUrl: tab.favIconUrl, pinned: tab.pinned };
}

/** 查询某窗口当前标签，更新内存缓存并安排落盘。 */
async function refreshWindowTabs(windowId: number): Promise<void> {
  try {
    const rawTabs = await browser.tabs.query({ windowId });
    const list = rawTabs
      .map((raw) => snapshotTabOf(raw))
      .filter((entry): entry is SnapshotTab => entry !== null);
    memWindowTabs[String(windowId)] = list;
    if (windowTabsFlushTimer) return;
    windowTabsFlushTimer = setTimeout(flushWindowTabs, 800);
  } catch {
    // 窗口可能已关闭，忽略
  }
}

/** 重新扫描某窗口标签并写入缓存（防抖 600ms）。 */
function scheduleWindowRefresh(windowId: number): void {
  const existing = windowRefreshTimers.get(windowId);
  if (existing) clearTimeout(existing);
  windowRefreshTimers.set(
    windowId,
    setTimeout(() => {
      windowRefreshTimers.delete(windowId);
      void refreshWindowTabs(windowId);
    }, 600)
  );
}

/** 启动：从 session 恢复缓存，并为当前所有窗口建索引。 */
async function initWindowTabsCache(): Promise<void> {
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const rec = await sessionArea.get(WINDOW_TABS_KEY);
      const val = rec[WINDOW_TABS_KEY];
      if (val && typeof val === 'object') memWindowTabs = val as WindowTabsCache;
    }
    const wins = await browser.windows.getAll({ populate: false }).catch(() => []);
    for (const win of wins) {
      if (typeof win.id === 'number') await refreshWindowTabs(win.id);
    }
  } catch {
    // 忽略：不影响其它功能
  }
}

/** 窗口关闭：用缓存的标签自动存为快照（关窗自动保存）。 */
async function handleWindowRemoved(windowId: number): Promise<void> {
  const idKey = String(windowId);
  let tabs = memWindowTabs[idKey];
  if (!tabs) {
    try {
      const sessionArea = browser.storage?.session;
      if (sessionArea) {
        const rec = await sessionArea.get(WINDOW_TABS_KEY);
        const cache = rec[WINDOW_TABS_KEY] as WindowTabsCache | undefined;
        if (cache) tabs = cache[idKey];
      }
    } catch {
      // 忽略
    }
  }
  delete memWindowTabs[idKey];
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const rec = await sessionArea.get(WINDOW_TABS_KEY);
      const cache = (rec[WINDOW_TABS_KEY] as WindowTabsCache) ?? {};
      if (cache[idKey]) {
        delete cache[idKey];
        await sessionArea.set({ [WINDOW_TABS_KEY]: cache }).catch(() => {});
      }
    }
  } catch {
    // 忽略
  }
  // 归档流程（archiveCurrentWindow）已自行留档并请求跳过本次自动保存。
  if (skipAutoSaveWindowIds.delete(windowId)) return;
  if (!tabs || tabs.length === 0) return;
  const settings = await settingsRepository.read();
  if (!settings.autoSaveSnapshots) return;
  const snapshot = buildSnapshot({ name: '', origin: 'auto', windowId, tabs });
  // 写盘失败（quota 超限等）只告警：自动保存是兜底链路，不应让异常逃逸为未捕获 rejection。
  await persistSnapshot(snapshot).catch((error) =>
    console.warn('[snapshots] auto-save failed', error)
  );
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export default defineBackground(() => {
  const coordinator = new ReuseCoordinator({
    scanWindow: async (windowId) => {
      const tabs = await browser.tabs.query({ windowId });
      return tabs.map(mapTab);
    },
    activate: (tabId) => browser.tabs.update(tabId, { active: true }).then(() => undefined),
    close: (tabId) => browser.tabs.remove(tabId),
    notifyReuse: () => {
      if (!cachedSettings.reuseNotifyEnabled) return;
      const notification = DuplicateReusedMessageSchema.parse({ type: 'duplicate-reused' });
      browser.runtime.sendMessage(notification).catch(() => {});
    }
  });

  // 同 URL 唯一化开关联动（设置存储在 chrome.storage.local）。
  const syncCoordinatorEnabled = async () => {
    try {
      const settings = await settingsRepository.read();
      coordinator.setEnabled(settings.uniqueUrlTabs);
    } catch {
      // 读取失败保持当前状态
    }
  };
  void syncCoordinatorEnabled();
  // 设置缓存：SW 启动读一次（badge/通知/菜单/omnibox 共用；变更经 watch 更新）。
  void syncCachedSettings();
  // 关窗自动保存：恢复窗口标签缓存并为当前窗口建索引。
  void initWindowTabsCache();
  // 注：uniqueUrlTabs 开关联动由下方 settingsRepository.watch 统一处理（含启动读），
  // 不再重复监听 storage.onChanged。

  browser.tabs.onCreated.addListener((tab) => {
    coordinator.handleCreated(mapTab(tab));
    refreshBadgeSoon();
    if (typeof tab.windowId === 'number') scheduleWindowRefresh(tab.windowId);
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    coordinator.handleUpdated(
      tabId,
      { url: Boolean(changeInfo.url), status: Boolean(changeInfo.status) },
      mapTab(tab)
    );
    if (changeInfo.url !== undefined || changeInfo.discarded !== undefined || changeInfo.pinned !== undefined) {
      refreshBadgeSoon();
    }
    if (typeof tab.windowId === 'number') scheduleWindowRefresh(tab.windowId);
  });
  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    coordinator.handleRemoved(tabId);
    refreshBadgeSoon();
    scheduleWindowRefresh(removeInfo.windowId);
  });
  browser.tabs.onAttached.addListener((_tabId, attachInfo) => {
    if (typeof attachInfo.newWindowId === 'number') scheduleWindowRefresh(attachInfo.newWindowId);
  });
  browser.tabs.onDetached.addListener((_tabId, detachInfo) => {
    if (typeof detachInfo.oldWindowId === 'number') scheduleWindowRefresh(detachInfo.oldWindowId);
  });
  // 预渲染置换：旧标签被新标签替换（无 onCreated/onRemoved 对），
  // 需显式结算旧任务并把新标签纳入追踪，否则窗口标签缓存与复用追踪短暂失真。
  browser.tabs.onReplaced?.addListener((addedTabId, removedTabId) => {
    coordinator.handleRemoved(removedTabId);
    browser.tabs
      .get(addedTabId)
      .then((tab) => {
        coordinator.handleCreated(mapTab(tab));
        if (typeof tab.windowId === 'number') scheduleWindowRefresh(tab.windowId);
      })
      .catch(() => {});
    refreshBadgeSoon();
  });

  // 窗口级事件：新建窗口建索引；窗口关闭触发自动保存。
  browser.windows.onCreated.addListener((win) => {
    if (typeof win.id === 'number') void refreshWindowTabs(win.id);
  });
  browser.windows.onRemoved.addListener((windowId) => {
    void handleWindowRemoved(windowId);
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (SettingsSyncedMessageSchema.safeParse(message).success) {
      void syncCachedSettings();
      return;
    }
    const skipAutoSave = SkipAutoSaveOnceMessageSchema.safeParse(message);
    if (skipAutoSave.success) {
      skipAutoSaveWindowIds.add(skipAutoSave.data.windowId);
      sendResponse({ ok: true });
      return;
    }
    const parsed = AllowDuplicateOnceMessageSchema.safeParse(message);
    if (!parsed.success) return;
    const { windowId, url } = parsed.data;
    coordinator.grantAllowance(windowId, url);
    sendResponse({ ok: true });
  });

  // 浏览器级快捷键命令分发（FR-D2.2）
  browser.commands?.onCommand.addListener(async (command) => {
    if (command === 'focus-search') {
      await openSidePanel();
      const message = SearchFocusMessageSchema.parse({ type: 'focus-search' });
      browser.runtime.sendMessage(message).catch(() => {});
      return;
    }
    if (command === 'open-panel') {
      await openSidePanel();
      return;
    }
    if (command === 'locate-active') {
      await openSidePanel();
      await queueAction({ type: 'locate-active' });
      return;
    }
    if (command === 'discard-inactive') {
      await discardInactiveTabs();
    }
  });

  // contextMenus：注册与点击处理
  const setupMenus = async (): Promise<void> => {
    const [folders, settings] = await Promise.all([
      foldersRepository.read(),
      settingsRepository.read()
    ]);
    if (!settings.contextMenusEnabled) {
      clearContextMenus();
      return;
    }
    rebuildContextMenus(folders);
  };
  browser.runtime.onInstalled.addListener(() => {
    enableActionClick();
    void setupMenus();
  });
  browser.runtime.onStartup.addListener(() => {
    enableActionClick();
    void setupMenus();
  });
  // 文件夹变化时刷新菜单子项（SW 存活期间）
  foldersRepository.watch((folders) => {
    if (cachedSettings.contextMenusEnabled) rebuildContextMenus(folders);
    else clearContextMenus();
  });
  // 设置变更：缓存更新 + 右键菜单开关联动（开关重新打开时按当前文件夹重建）
  // + 角标即时刷新 + 自动休眠闹钟启停
  settingsRepository.watch((settings) => {
    cachedSettings = settings;
    coordinator.setEnabled(settings.uniqueUrlTabs);
    if (settings.contextMenusEnabled) void setupMenus();
    else clearContextMenus();
    void syncAutoDiscardAlarm(settings);
    refreshBadgeSoon();
  });

  browser.contextMenus?.onClicked.addListener((info, tab) => {
    const id = info.menuItemId as string;
    if (id.startsWith('th:page:add-folder:') || id.startsWith('th:link:add-folder:')) {
      const folderId = id.split(':').at(-1);
      if (!folderId) return;
      if (id.startsWith('th:link:')) {
        if (info.linkUrl) {
          void addEntryToFolder(folderId, {
            url: info.linkUrl,
            title: info.selectionText || info.linkUrl
          }).then((added) => {
            if (!added) notifyUser('TabHaven', 'Already in a folder (deduped).');
          });
        }
      } else if (tab?.url) {
        void addEntryToFolder(folderId, {
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl
        }).then((added) => {
          if (!added) notifyUser('TabHaven', 'Already in a folder (deduped).');
        });
      }
      return;
    }
    // contextMenus 回调第二参 tab 即目标标签（page 上下文=激活标签；tab 上下文=被右键标签）。
    const targetTab = tab;
    switch (id) {
      case MENU_IDS.pageDiscard:
        void discardTabSafely(targetTab);
        break;
      case MENU_IDS.tabDiscard:
        void discardTabSafely(targetTab);
        break;
      case MENU_IDS.pagePin: {
        if (targetTab?.url && targetTab.id !== undefined) {
          const pin = pinFromTab({
            url: targetTab.url,
            title: targetTab.title || '',
            favIconUrl: targetTab.favIconUrl
          });
          if (pin) {
            void (async () => {
              const pins = await pinsRepository.read();
              await pinsRepository.write(dedupePins([...pins.filter((p) => p.identity !== pin.identity), pin]));
              if (!targetTab.pinned && targetTab.id !== undefined) {
                await browser.tabs.update(targetTab.id, { pinned: true }).catch(() => {});
              }
            })();
          }
        }
        break;
      }
      case MENU_IDS.pageSearchSite:
      case MENU_IDS.tabSearchSite: {
        const host = hostnameOf(targetTab?.url);
        if (host) void queueAction({ type: 'search-domain', query: host.replace(/^www\./, '') });
        break;
      }
      case MENU_IDS.actionOpenPanel:
        void openSidePanel();
        break;
      case MENU_IDS.actionDiscardInactive:
        void discardInactiveTabs();
        break;
      case MENU_IDS.actionSettings:
        void browser.runtime.openOptionsPage();
        break;
    }
  });

  // omnibox：th <关键词>（omniboxEnabled 开关）
  browser.omnibox?.onInputChanged.addListener((text, suggest) => {
    if (!cachedSettings.omniboxEnabled) {
      suggest([]);
      return;
    }
    void queryOmnibox(text).then((results) => suggest(results));
  });
  browser.omnibox?.onInputEntered.addListener((content) => {
    if (!cachedSettings.omniboxEnabled) return;
    void handleOmniboxEnter(content);
  });
  browser.omnibox?.onInputStarted.addListener(() => {
    if (!cachedSettings.omniboxEnabled) return;
    void browser.omnibox.setDefaultSuggestion({
      description: 'TabHaven: type to search tabs, pins and folders'
    });
  });

  // action badge：标签事件驱动刷新（500ms 节流）
  refreshBadgeSoon();

  function enableActionClick(): void {
    if (browser.sidePanel?.setPanelBehavior) {
      browser.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
    }
  }
  void enableActionClick();

  // 自动休眠：白名单 + 台账 + 通知（alarms 保活调度，MV3 SW 回收后仍可触发）
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'tabhaven-auto-discard') void runAutoDiscard();
  });
  // 仅在开启自动休眠时创建闹钟（关闭时不清醒 SW 空跑）；SW 启动按当前设置对齐一次。
  void settingsRepository
    .read()
    .then((settings) => syncAutoDiscardAlarm(settings))
    .catch(() => {});
});
