import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { dedupePins, createFolderItem, pinFromTab } from '@/core/fixed/FolderOps';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { FixedFolder, Settings } from '@/core/schema/models';
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
  SearchDomainMessageSchema,
  SearchFocusMessageSchema,
  SettingsSyncedMessageSchema
} from '@/platform/messages';
import { createTabsWithUrls } from '@/platform/tabs';

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
const PENDING_ACTIONS_KEY = 'tabhaven.pending-actions';
type PendingAction = { type: 'search-domain'; query: string } | { type: 'locate-active' };

async function queueAction(action: PendingAction): Promise<void> {
  try {
    const sessionArea = browser.storage?.session;
    if (sessionArea) {
      const existing = await sessionArea.get(PENDING_ACTIONS_KEY);
      const list: PendingAction[] = Array.isArray(existing[PENDING_ACTIONS_KEY])
        ? (existing[PENDING_ACTIONS_KEY] as PendingAction[])
        : [];
      list.push(action);
      await sessionArea.set({ [PENDING_ACTIONS_KEY]: list.slice(-5) });
    }
  } catch {
    // session 存储不可用时仅即时广播
  }
  const message =
    action.type === 'search-domain'
      ? SearchDomainMessageSchema.parse({ type: 'search-domain', query: action.query })
      : LocateActiveMessageSchema.parse({ type: 'locate-active' });
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

const menuText = (key: MenuMessageKey): string => browser.i18n.getMessage(key) ?? key;

/** 重建右键菜单（文件夹列表变化时刷新子菜单）。 */
function rebuildContextMenus(folders: readonly FixedFolder[]): void {
  const menus = browser.contextMenus;
  if (!menus) return;
  void menus.removeAll().then(() => {
    // 页面右键
    void menus.create({ id: MENU_IDS.pageDiscard, title: menuText('menuDiscardPage'), contexts: ['page'] });
    void menus.create({ id: MENU_IDS.pagePin, title: menuText('menuPinPage'), contexts: ['page'] });
    void menus.create({ id: MENU_IDS.pageSearchSite, title: menuText('menuSearchSite'), contexts: ['page'] });
    if (folders.length > 0) {
      void menus.create({ id: MENU_IDS.pageFolderParent, title: menuText('menuAddPageToFolder'), contexts: ['page'] });
      for (const folder of folders) {
        void menus.create({
          id: `th:page:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.pageFolderParent,
          contexts: ['page']
        });
      }
    }
    // 链接右键
    if (folders.length > 0) {
      void menus.create({ id: MENU_IDS.linkFolderParent, title: menuText('menuAddLinkToFolder'), contexts: ['link'] });
      for (const folder of folders) {
        void menus.create({
          id: `th:link:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.linkFolderParent,
          contexts: ['link']
        });
      }
    }
    // 标签栏右键
    void menus.create({ id: MENU_IDS.tabDiscard, title: menuText('menuDiscardTab'), contexts: ['tab'] });
    void menus.create({ id: MENU_IDS.tabSearchSite, title: menuText('menuSearchSite'), contexts: ['tab'] });
    // 工具栏图标右键
    void menus.create({ id: MENU_IDS.actionOpenPanel, title: menuText('menuOpenPanel'), contexts: ['action'] });
    void menus.create({ id: MENU_IDS.actionDiscardInactive, title: menuText('menuDiscardInactive'), contexts: ['action'] });
    void menus.create({ id: MENU_IDS.actionSettings, title: menuText('menuOpenSettings'), contexts: ['action'] });
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

/** 休眠当前窗口全部非激活、可安全丢弃的标签（含台账与通知）。 */
async function discardInactiveTabs(): Promise<void> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const targets: number[] = [];
  for (const rawTab of tabs) {
    const tab = mapTab(rawTab);
    if (tab.id >= 0 && canSafelyDiscardTab(tab)) targets.push(tab.id);
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
      if (!tab.url) continue;
      if (seen.has(tab.url)) dupGroups.add(tab.url);
      seen.add(tab.url);
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
  const push = (content: string, title: string, subtitle: string): void => {
    if (suggestions.length >= 12) return;
    suggestions.push({
      content,
      description: `<match>${title.replace(/[<>]/g, '')}</match> <url>${subtitle}</url>`
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
  browser.storage?.local?.onChanged.addListener((changes) => {
    if (!changes[settingsRepository.keyName]) return;
    void syncCoordinatorEnabled();
  });

  browser.tabs.onCreated.addListener((tab) => {
    coordinator.handleCreated(mapTab(tab));
    refreshBadgeSoon();
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
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    coordinator.handleRemoved(tabId);
    refreshBadgeSoon();
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (SettingsSyncedMessageSchema.safeParse(message).success) {
      void syncCachedSettings();
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
      browser.contextMenus?.removeAll();
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
    else browser.contextMenus?.removeAll();
  });
  // 设置变更：缓存更新 + 右键菜单开关联动（开关重新打开时按当前文件夹重建）+ 角标即时刷新
  settingsRepository.watch((settings) => {
    cachedSettings = settings;
    coordinator.setEnabled(settings.uniqueUrlTabs);
    if (settings.contextMenusEnabled) void setupMenus();
    else browser.contextMenus?.removeAll();
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
  // periodInMinutes 最小为 1；同名闹钟重复创建即重置，幂等安全。
  browser.alarms.create('tabhaven-auto-discard', { periodInMinutes: 1 }).catch(() => {});
});
