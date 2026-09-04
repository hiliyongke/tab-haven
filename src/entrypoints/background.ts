import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
import { mapTab } from '@/platform/tabs';
import { logDegraded } from '@/platform/diagnostics';
import { dedupePins, pinFromTab } from '@/core/fixed/FolderOps';
import {
  foldersRepository,
  pinsRepository,
  settingsRepository
} from '@/platform/storage/repositories';
import { initHeadlessI18n } from '@/i18n/headless';
import { createPersistedAllowanceLedger } from '@/platform/reuse/persistedLedger';
import {
  AllowDuplicateOnceMessageSchema,
  DuplicateReusedMessageSchema,
  SettingsSyncedMessageSchema,
  SkipAutoSaveOnceMessageSchema
} from '@/platform/messages';
import {
  cachedSettings,
  syncCachedSettings,
  queueAction,
  openSidePanel,
  hostnameOf,
  notifyUser
} from './background/shared';
import {
  MENU_IDS,
  rebuildContextMenus,
  clearContextMenus,
  addEntryToFolder,
  discardTabSafely,
  setupMenus
} from './background/contextMenus';
import {
  runAutoDiscard,
  discardInactiveTabs,
  syncAutoDiscardAlarm
} from './background/autoDiscard';
import { AUTO_SNAPSHOT_ALARM, runAutoSnapshot, syncAutoSnapshotAlarm } from './background/autoSnapshot';
import { refreshBadgeSoon } from './background/badge';
import { runActionClickRegroup } from './background/actionRegroup';
import { setupNoCache } from './background/noCache';
import { queryOmnibox, handleOmniboxEnter } from './background/omnibox';
import {
  scheduleWindowRefresh,
  initWindowTabsCache,
  handleWindowRemoved,
  skipAutoSaveWindowIds,
  refreshWindowTabs,
  recordActiveTab,
  getLastActiveTabId
} from './background/windowCache';

export default defineBackground(() => {
  // 后台文案轨道：通知/自动快照默认名等 SW 侧文案按用户语言解析。
  // 异步初始化不阻塞消息注册；完成前的 t() 调用回退浏览器语言判定。
  void initHeadlessI18n();

  // 豁免账本镜像到 storage.session：SW 回收后重新拉起时恢复未过期令牌，
  // 消除「撤销恢复/快照恢复的授权因回收丢失 → 新标签被误合并」的边缘时序（R-A）。
  const { ledger: allowanceLedger, ready: allowanceLedgerReady } = createPersistedAllowanceLedger();

  const coordinator = new ReuseCoordinator(
    {
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
    },
    { allowances: allowanceLedger, allowancesReady: allowanceLedgerReady }
  );

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

  /**
   * 工具栏图标点击行为（settings.actionClickMode）：
   *  - 'panel'（默认）：Chrome 直接打开侧边栏（openPanelOnActionClick）；
   *  - 'regroup'：不弹面板，改为在 onClicked 里后台整理临时区标签。
   * setPanelBehavior 不跨浏览器会话持久，SW 每次唤醒/设置变更都要对齐一次；
   * 读取实时设置而非共享缓存，避开 SW 刚唤醒时缓存尚未就绪的窗口。
   */
  async function syncActionClickBehavior(): Promise<void> {
    if (!browser.sidePanel?.setPanelBehavior) return;
    try {
      const settings = await settingsRepository.read();
      await browser.sidePanel.setPanelBehavior({
        openPanelOnActionClick: settings.actionClickMode !== 'regroup'
      });
    } catch (error) {
      logDegraded('background', '对齐工具栏点击行为失败', error);
    }
  }
  void syncActionClickBehavior();

  /**
   * 全局「新建标签位置」（settings.newTabPosition）：
   * 任何来源的新标签（Ctrl+T / 浏览器 + 按钮 / 面板按钮 / 固定条目打开）
   * 在 'after-active' 模式下都移动到上一激活标签之后。面板按钮路径已在
   * 创建时指定 index，此处幂等跳过；'end' 模式下直接返回（浏览器默认即末尾）。
   * 锚点用 onActivated 维护的最近激活标签——onCreated 时新标签已被 Chrome
   * 激活，query active 只会查到它自己。
   */
  async function enforceNewTabPosition(tab: {
    id?: number;
    windowId?: number;
    index?: number;
    pinned?: boolean;
  }): Promise<void> {
    try {
      if (cachedSettings.newTabPosition !== 'after-active') return;
      if (tab.id === undefined || tab.windowId === undefined) return;
      if (tab.pinned) return;
      const anchorId = getLastActiveTabId(tab.windowId);
      if (anchorId === undefined || anchorId === tab.id) return;
      const anchor = await browser.tabs.get(anchorId).catch(() => undefined);
      if (!anchor || anchor.windowId !== tab.windowId || anchor.index === undefined) return;
      const target = anchor.index + 1;
      if (tab.index === target) return;
      await browser.tabs.move(tab.id, { windowId: tab.windowId, index: target });
    } catch (error) {
      logDegraded('background', '新建标签位置调整失败', error);
    }
  }

  // 关窗自动保存：恢复窗口标签缓存并为当前窗口建索引。
  void initWindowTabsCache();
  // 开发者禁缓存：DNR 规则对齐 + 命中站点警示条（设置变更经 watch 实时同步）。
  setupNoCache();
  // 注：uniqueUrlTabs 开关联动由下方 settingsRepository.watch 统一处理（含启动读），
  // 不再重复监听 storage.onChanged。

  browser.tabs.onCreated.addListener((tab) => {
    coordinator.handleCreated(mapTab(tab));
    refreshBadgeSoon();
    if (typeof tab.windowId === 'number') scheduleWindowRefresh(tab.windowId);
    void enforceNewTabPosition(tab);
  });
  browser.tabs.onActivated.addListener((info) => {
    if (typeof info.windowId === 'number' && typeof info.tabId === 'number') {
      recordActiveTab(info.windowId, info.tabId);
    }
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    coordinator.handleUpdated(
      tabId,
      { url: Boolean(changeInfo.url), status: Boolean(changeInfo.status) },
      mapTab(tab)
    );
    if (
      changeInfo.url !== undefined ||
      changeInfo.discarded !== undefined ||
      changeInfo.pinned !== undefined
    ) {
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

  // 浏览器级快捷键命令分发
  browser.commands?.onCommand.addListener(async (command) => {
    if (command === 'focus-search') {
      await openSidePanel();
      // 走挂起队列而非直接广播：面板刚打开时监听可能尚未注册，直接发消息会丢。
      await queueAction({ type: 'focus-search' });
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
    void syncActionClickBehavior();
    void setupMenus();
  });
  browser.runtime.onStartup.addListener(() => {
    void syncActionClickBehavior();
    void setupMenus();
  });
  // 文件夹变化时刷新菜单子项（SW 存活期间）
  foldersRepository.watch((folders) => {
    if (cachedSettings.contextMenusEnabled) rebuildContextMenus(folders);
    else clearContextMenus();
  });
  // 设置变更：缓存更新 + 右键菜单开关联动（开关重新打开时按当前文件夹重建）
  // + 角标即时刷新 + 自动休眠闹钟启停 + 工具栏点击行为切换
  settingsRepository.watch((settings) => {
    void syncCachedSettings();
    coordinator.setEnabled(settings.uniqueUrlTabs);
    if (settings.contextMenusEnabled) void setupMenus();
    else clearContextMenus();
    void syncAutoDiscardAlarm(settings);
    // 自动保存开关/间隔变更即时对齐闹钟（周期变化也需重建，alarms 无法就地改周期）。
    void syncAutoSnapshotAlarm(settings);
    void syncActionClickBehavior();
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
            if (!added) notifyUser('Tabs', 'Already in a folder (deduped).');
          });
        }
      } else if (tab?.url) {
        void addEntryToFolder(folderId, {
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl
        }).then((added) => {
          if (!added) notifyUser('Tabs', 'Already in a folder (deduped).');
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
              await pinsRepository.write(
                dedupePins([...pins.filter((p) => p.identity !== pin.identity), pin])
              );
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
      description: 'Tabs: type to search tabs, pins and folders'
    });
  });

  // action badge：标签事件驱动刷新（500ms 节流）
  refreshBadgeSoon();

  // regroup 模式：openPanelOnActionClick 为 false 时 Chrome 才会派发 onClicked，
  // 两种点击方式由设置驱动的 behavior 切换实现并存。
  browser.action?.onClicked.addListener(() => {
    void settingsRepository
      .read()
      .then(async (settings) => {
        if (settings.actionClickMode !== 'regroup') return;
        const count = await runActionClickRegroup();
        if (count <= 0) return;
        // 轻量完成反馈：角标短暂打勾（无文案噪音），随后按设置恢复正常角标。
        await browser.action.setBadgeText({ text: '✓' });
        await browser.action.setBadgeBackgroundColor({ color: '#16a34a' });
        setTimeout(() => refreshBadgeSoon(), 1500);
      })
      .catch((error) => logDegraded('background', '工具栏点击处理失败', error));
  });

  // 自动休眠：白名单 + 台账 + 通知（alarms 保活调度，MV3 SW 回收后仍可触发）
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'tabs-auto-discard') void runAutoDiscard();
    // 定时自动快照：兜住「崩溃 / 强制退出 / 长期不关窗」这些关窗保存覆盖不到的场景。
    if (alarm.name === AUTO_SNAPSHOT_ALARM) void runAutoSnapshot();
  });
  // 仅在开启时创建闹钟（关闭时不让 SW 空跑）；SW 启动按当前设置对齐一次。
  void settingsRepository
    .read()
    .then(async (settings) => {
      await syncAutoDiscardAlarm(settings);
      await syncAutoSnapshotAlarm(settings);
    })
    .catch(() => {});
});
