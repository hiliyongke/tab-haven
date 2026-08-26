import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
import { mapTab } from '@/platform/tabs';
import { dedupePins, pinFromTab } from '@/core/fixed/FolderOps';
import { foldersRepository, pinsRepository, settingsRepository } from '@/platform/storage/repositories';
import {
  AllowDuplicateOnceMessageSchema,
  DuplicateReusedMessageSchema,
  SettingsSyncedMessageSchema,
  SkipAutoSaveOnceMessageSchema,
  SearchFocusMessageSchema
} from '@/platform/messages';
import { cachedSettings, syncCachedSettings, queueAction, openSidePanel, hostnameOf, notifyUser } from './background/shared';
import {
  MENU_IDS,
  rebuildContextMenus,
  clearContextMenus,
  addEntryToFolder,
  discardTabSafely,
  setupMenus
} from './background/contextMenus';
import { runAutoDiscard, discardInactiveTabs, syncAutoDiscardAlarm } from './background/autoDiscard';
import { refreshBadgeSoon } from './background/badge';
import { queryOmnibox, handleOmniboxEnter } from './background/omnibox';
import {
  scheduleWindowRefresh,
  initWindowTabsCache,
  handleWindowRemoved,
  skipAutoSaveWindowIds,
  refreshWindowTabs
} from './background/windowCache';

export default defineBackground(() => {
  const coordinator = new ReuseCoordinator({
    scanWindow: async (windowId) => {
      const tabs = await browser.tabs.query({ windowId });
      return tabs.map(mapTab);
    },
    activate: (tabId) => browser.tabs.update(tabId, { active: true }).then(() => undefined),
    close: (tabId) => browser.tabs.remove(tabId),
    // 复用通知经 runtime 消息推给面板（无面板时静默丢弃）。
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
    void syncCachedSettings();
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
  // 实时建议加 120ms 防抖，避免每个字符都触发读存储 + 全量扫描。
  let omniboxSuggestTimer: ReturnType<typeof setTimeout> | undefined;
  browser.omnibox?.onInputChanged.addListener((text, suggest) => {
    if (!cachedSettings.omniboxEnabled) {
      suggest([]);
      return;
    }
    if (omniboxSuggestTimer) clearTimeout(omniboxSuggestTimer);
    omniboxSuggestTimer = setTimeout(() => {
      void queryOmnibox(text).then((results) => suggest(results));
    }, 120);
  });
  browser.omnibox?.onInputEntered.addListener((content, disposition) => {
    if (!cachedSettings.omniboxEnabled) return;
    void handleOmniboxEnter(content, disposition);
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
