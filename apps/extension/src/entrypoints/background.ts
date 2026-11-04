import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
import { getTab, mapTab, setPinned } from '@/platform/tabs';
import { installGlobalErrorHandlers, logDegraded } from '@/platform/diagnostics';
import { openOptionsPage } from '@/platform/navigation';
import { openSidePanel } from '@/platform/sidePanel';
import { setSnapshotEvictionListener } from '@/platform/snapshot/snapshots';
import { normalizeHostname } from '@/core/url/hostname';
import { foldersRepository, settingsRepository } from '@/platform/storage/repositories';
import { initHeadlessI18n, t } from '@/i18n/headless';
import { createPersistedAllowanceLedger } from '@/platform/reuse/persistedLedger';
import { MessageSchema, sendMessage } from '@/platform/messages';
import { resolveReuseClosedAck } from '@/platform/reuse/reuseClosedPending';
import type { Settings } from '@/core/schema/models';
import {
  cachedSettings,
  syncCachedSettings,
  queueAction,
  runPanelSearch,
  hostnameOf,
  notifyUser
} from '@/platform/background/shared';
import {
  MENU_IDS,
  rebuildContextMenus,
  clearContextMenus,
  addEntryToFolder,
  addPinFromTab,
  discardTabSafely,
  setupMenus
} from '@/platform/background/contextMenus';
import {
  AUTO_DISCARD_ALARM,
  runAutoDiscard,
  discardInactiveTabs,
  syncAutoDiscardAlarm
} from '@/platform/background/autoDiscard';
import {
  AUTO_SNAPSHOT_ALARM,
  runAutoSnapshot,
  syncAutoSnapshotAlarm
} from '@/platform/background/autoSnapshot';
import { refreshBadge, refreshBadgeSoon, showBadgeOverride } from '@/platform/background/badge';
import { runActionClickRegroup } from '@/platform/background/actionRegroup';
import { applyAutoGroupSetting, scheduleAutoGroupReconcile } from '@/platform/background/autoGroup';
import { setupNoCache } from '@/platform/background/noCache';
import { queryOmnibox, handleOmniboxEnter } from '@/platform/background/omnibox';
import {
  scheduleWindowRefresh,
  initWindowTabsCache,
  handleWindowRemoved,
  markSkipAutoSave,
  refreshWindowTabs,
  recordActiveTab
} from '@/platform/background/windowCache';
import {
  AUTO_GROUP_UPDATE_KEYS,
  BADGE_DONE_COLOR,
  BADGE_DONE_TTL_MS,
  WINDOW_CACHE_UPDATE_KEYS,
  enforceNewTabPosition,
  notifyAddToFolderResult,
  registerUninstallUrl,
  reportReuseClosed,
  syncActionClickBehavior
} from '@/platform/background/runtimeHelpers';

export default defineBackground(() => {
  // 全局异常兜底：background 各异步路径漏网的 rejection 必须留痕。
  installGlobalErrorHandlers();

  /** 后台侧快照淘汰的告知出口：SW 里没有 snapshotStore 注册监听，关窗/定时快照的淘汰需系统通知。 */
  setSnapshotEvictionListener((count) => {
    notifyUser('Tabs', t('快照超出保留上限，已淘汰最旧的 {{count}} 份', { count }));
  });

  // 后台文案轨道：通知/自动快照默认名按用户语言解析。异步初始化不阻塞消息注册。
  void initHeadlessI18n();

  // 豁免账本镜像到 session：SW 回收后恢复未过期令牌，避免恢复授权因回收丢失导致误合并。
  const { ledger: allowanceLedger, ready: allowanceLedgerReady } = createPersistedAllowanceLedger();

  const coordinator = new ReuseCoordinator(
    {
      scanWindow: async (windowId) => {
        const tabs = await browser.tabs.query({ windowId });
        return tabs.map(mapTab);
      },
      activate: async (tabId) => {
        await browser.tabs.update(tabId, { active: true });
      },
      close: (tabId) => browser.tabs.remove(tabId),
      // 复用通知经 runtime 消息推给面板（无面板时静默丢弃）。
      notifyReuse: () => {
        if (!cachedSettings.reuseNotifyEnabled) return;
        sendMessage({ type: 'duplicate-reused' });
      },
      // 复用关闭的标签快照回传面板登记撤销（与 notifyReuse 分开：撤销登记不受提示开关影响）。
      reportClosed: reportReuseClosed
    },
    { allowances: allowanceLedger, allowancesReady: allowanceLedgerReady }
  );

  // 同 URL 唯一化开关联动（fail-closed：读失败维持关闭并留痕）。
  const syncCoordinatorEnabled = async () => {
    try {
      const settings = await settingsRepository.readStrict();
      coordinator.setEnabled(settings.uniqueUrlTabs);
    } catch (error) {
      coordinator.setEnabled(false);
      logDegraded(
        'background',
        '启动时读取同网址唯一化开关失败，本次启动维持关闭（fail-closed）',
        error
      );
    }
  };
  void syncCoordinatorEnabled();
  /**
   * 闹钟签名：同名 alarms.create 会重置触发时间，无条件重建会把「每 N 分钟一次」的自动快照
   * 无限期推后。自动休眠只看开关，自动快照只看「开关 + 周期」，其余设置写入不触碰闹钟。
   */
  let discardAlarmEnabled: boolean | undefined;
  let snapshotAlarmSignature: string | undefined;

  /** 按设置对齐两个周期闹钟；各自的输入未变则跳过重建。 */
  const syncAlarms = async (settings: Settings): Promise<void> => {
    if (settings.autoDiscardEnabled !== discardAlarmEnabled) {
      discardAlarmEnabled = settings.autoDiscardEnabled;
      await syncAutoDiscardAlarm(settings);
    }
    const next = `${settings.autoSaveSnapshots}|${settings.autoSnapshotIntervalMin}`;
    if (next !== snapshotAlarmSignature) {
      snapshotAlarmSignature = next;
      await syncAutoSnapshotAlarm(settings);
    }
  };

  // 设置缓存：SW 启动读一次（badge/通知/菜单/omnibox 共用）。读回后直刷角标，
  // 避免冷启动 500ms 防抖定时器先触发时按默认模式渲染且无自愈路径。
  void syncCachedSettings().then(() => refreshBadge());

  /**
   * 自动分组的启动对账：SW 每次被回收/浏览器启动后，可能存在「已满足聚合条件但没分组」的
   * 存量标签。幂等：只为尚无 groupId 的标签建组。
   */
  void settingsRepository
    .read()
    .then((settings) => applyAutoGroupSetting(settings))
    .catch((error: unknown) => logDegraded('auto-group', '启动读取自动分组设置失败', error));

  void syncActionClickBehavior();

  // 关窗自动保存：恢复窗口标签缓存并为当前窗口建索引。
  void initWindowTabsCache();
  // 开发者禁缓存：DNR 规则对齐 + 命中站点警示条。
  setupNoCache();
  // 注：uniqueUrlTabs 开关联动由下方 settingsRepository.watch 统一处理（含启动读）。

  browser.tabs.onCreated.addListener((tab) => {
    coordinator.handleCreated(mapTab(tab));
    refreshBadgeSoon();
    if (typeof tab.windowId === 'number') scheduleWindowRefresh(tab.windowId);
    void enforceNewTabPosition(tab);
    // 自动分组在标签「出生」这帧就登记：Chrome 会把从组内标签点开的新标签直接塞进同一个组。
    scheduleAutoGroupReconcile(tab.windowId);
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
    // 仅采集口径内的字段变化才刷新缓存：标题动画/计时器类站点的高频 onUpdated 会让 SW 无法空闲回收。
    if (
      typeof tab.windowId === 'number' &&
      WINDOW_CACHE_UPDATE_KEYS.some((key) => key in changeInfo)
    ) {
      scheduleWindowRefresh(tab.windowId);
    }
    // 域名就绪 / 入组状态变化 → 自动分组对账。
    if (AUTO_GROUP_UPDATE_KEYS.some((key) => key in changeInfo)) {
      scheduleAutoGroupReconcile(tab.windowId);
    }
  });
  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    coordinator.handleRemoved(tabId);
    refreshBadgeSoon();
    // windowId 缺失时 scheduleWindowRefresh 会按 undefined 建键，产生永不清理的幽灵窗口。
    if (typeof removeInfo.windowId === 'number') scheduleWindowRefresh(removeInfo.windowId);
    scheduleAutoGroupReconcile(removeInfo.windowId);
  });
  browser.tabs.onAttached.addListener((_tabId, attachInfo) => {
    if (typeof attachInfo.newWindowId === 'number') scheduleWindowRefresh(attachInfo.newWindowId);
    scheduleAutoGroupReconcile(attachInfo.newWindowId);
  });
  browser.tabs.onDetached.addListener((_tabId, detachInfo) => {
    if (typeof detachInfo.oldWindowId === 'number') scheduleWindowRefresh(detachInfo.oldWindowId);
    scheduleAutoGroupReconcile(detachInfo.oldWindowId);
  });
  // 预渲染置换：旧标签被新标签替换（无 onCreated/onRemoved 对），显式结算旧任务并追踪新标签。
  browser.tabs.onReplaced?.addListener((addedTabId, removedTabId) => {
    coordinator.handleRemoved(removedTabId);
    void (async () => {
      try {
        const tab = await getTab(addedTabId);
        if (!tab) return;
        coordinator.handleCreated(tab);
        if (typeof tab.windowId === 'number') scheduleWindowRefresh(tab.windowId);
      } catch (error) {
        // 置换后瞬间又被关闭时 get 失败：留痕即可，一次性漏判不必当故障。
        logDegraded('background', `onReplaced：获取新标签 ${addedTabId} 失败`, error);
      }
    })();
    refreshBadgeSoon();
  });

  // 窗口级事件：新建窗口建索引；窗口关闭触发自动保存。
  browser.windows.onCreated.addListener((win) => {
    if (typeof win.id === 'number') void refreshWindowTabs(win.id);
  });
  browser.windows.onRemoved.addListener((windowId) => {
    void handleWindowRemoved(windowId);
  });

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    // 来源校验：端点一旦放开 externally_connectable 就会暴露，前置拦截。
    // 用 sender?.id 而非 sender.id：单参数调用（测试桩）会在读 sender.id 时抛 TypeError 吞掉消息通道。
    if (sender?.id !== undefined && sender.id !== browser.runtime.id) return;

    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.type) {
      case 'settings-synced':
        void syncCachedSettings();
        sendResponse({ ok: true });
        return;
      case 'reuse-closed-ack':
        resolveReuseClosedAck(message.batchId);
        sendResponse({ ok: true });
        return;
      case 'skip-auto-save-once':
        // 标记镜像到 session 后才应答（SW 回收不丢标记），故走异步应答通道。
        void markSkipAutoSave(message.windowId).then(() => sendResponse({ ok: true }));
        return true;
      case 'allow-duplicate-once':
        coordinator.grantAllowance(message.windowId, message.url);
        sendResponse({ ok: true });
        return;
      default:
        // SW → UI 方向的消息由 UI 侧处理，SW 无需响应。
        return;
    }
  });

  // 浏览器级快捷键命令分发。保持 async 让调用方可 await；内部兜住异常避免 unhandled rejection。
  browser.commands?.onCommand.addListener(async (command) => {
    try {
      if (command === 'focus-search') {
        await openSidePanel();
        // 走挂起队列：面板刚打开时监听可能尚未注册，直接发消息会丢。
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
    } catch (error) {
      logDegraded('background', `快捷键命令执行失败：${command}`, error);
    }
  });

  browser.runtime.onInstalled.addListener(() => {
    void syncActionClickBehavior();
    void setupMenus();
    registerUninstallUrl();
  });
  browser.runtime.onStartup.addListener(() => {
    void syncActionClickBehavior();
    void setupMenus();
    registerUninstallUrl();
  });
  // 文件夹变化时刷新菜单子项。
  foldersRepository.watch((folders) => {
    if (cachedSettings.contextMenusEnabled) rebuildContextMenus(folders);
    else clearContextMenus();
  });
  // 设置变更：缓存更新 + 菜单开关联动 + 角标 + 闹钟对齐 + 点击行为 + 自动分组对账。
  settingsRepository.watch((settings) => {
    void syncCachedSettings();
    coordinator.setEnabled(settings.uniqueUrlTabs);
    if (settings.contextMenusEnabled) void setupMenus();
    else clearContextMenus();
    // 周期变化也需重建闹钟；与闹钟无关的设置写入不重建（见 alarmSignature）。
    void syncAlarms(settings);
    void syncActionClickBehavior();
    applyAutoGroupSetting(settings);
    refreshBadgeSoon();
  });

  browser.contextMenus?.onClicked.addListener((info, tab) => {
    const id = info.menuItemId as string;
    if (id.startsWith('th:page:add-folder:') || id.startsWith('th:link:add-folder:')) {
      const folderId = id.split(':').at(-1);
      if (!folderId) {
        logDegraded('background', `右键菜单 id 无法解析出文件夹 id：${id}`);
        return;
      }
      if (id.startsWith('th:link:')) {
        if (info.linkUrl) {
          void addEntryToFolder(folderId, {
            url: info.linkUrl,
            title: info.selectionText || info.linkUrl
          })
            .then((result) => notifyAddToFolderResult(result))
            .catch((error: unknown) => logDegraded('background', '右键加入文件夹失败', error));
        }
      } else if (tab?.url) {
        void addEntryToFolder(folderId, {
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl
        })
          .then((result) => notifyAddToFolderResult(result))
          .catch((error: unknown) => logDegraded('background', '右键加入文件夹失败', error));
      }
      return;
    }
    // contextMenus 回调第二参 tab 即目标标签（page=激活标签；tab=被右键标签）。
    const targetTab = tab;
    switch (id) {
      case MENU_IDS.pageDiscard:
        void discardTabSafely(targetTab);
        break;
      case MENU_IDS.tabDiscard:
        void discardTabSafely(targetTab);
        break;
      // 标签栏「固定」与页面「固定」同一处理分支：写进固定图标区并置 pinned。
      case MENU_IDS.tabPin:
      case MENU_IDS.pagePin: {
        if (targetTab?.url && targetTab.id !== undefined) {
          // addPinFromTab 内含上限预检与失败留痕（与面板 addPin 同口径），写路径只此一处。
          void (async () => {
            const pinned = await addPinFromTab({
              url: targetTab.url,
              title: targetTab.title
            });
            if (pinned && !targetTab.pinned && targetTab.id !== undefined) {
              await setPinned(targetTab.id, true);
            }
            // 成功也要有反馈：按真实结果反馈，不假设成功。
            notifyUser('Tabs', t(pinned ? '已加入常驻磁贴。' : '加入常驻磁贴失败，请重试。'));
          })().catch((error: unknown) => {
            // 锁请求被中止/仓库读失败都走这里：不接住会变 unhandled rejection 且用户收不到通知。
            logDegraded('background', '加入常驻磁贴失败', error);
            notifyUser('Tabs', t('加入常驻磁贴失败，请重试。'));
          });
        }
        break;
      }
      case MENU_IDS.pageSearchSite:
      case MENU_IDS.tabSearchSite: {
        const host = hostnameOf(targetTab?.url);
        // 与地址栏搜索共用「先开面板再入队」路径：只入队时面板未打开，用户看不到任何反应。
        if (host) {
          void runPanelSearch(normalizeHostname(host)).catch((error) =>
            logDegraded('background', '右键按域名搜索失败', error)
          );
        }
        break;
      }
      case MENU_IDS.actionOpenPanel:
        void openSidePanel();
        break;
      case MENU_IDS.actionDiscardInactive:
        void discardInactiveTabs();
        break;
      case MENU_IDS.actionSettings:
        openOptionsPage();
        break;
    }
  });

  // omnibox：t <关键词>。suggest 是必须调用的一次性回调；延迟到后续定时器会受 Service Worker 生命周期影响。
  browser.omnibox?.onInputChanged.addListener((text, suggest) => {
    if (!cachedSettings.omniboxEnabled) {
      suggest([]);
      return;
    }
    // 必须兜底：reject 时不调用 suggest 会让地址栏永久等待，且留下未捕获 rejection。
    void (async () => {
      try {
        suggest(await queryOmnibox(text));
      } catch (error) {
        logDegraded('background', '地址栏建议生成失败', error);
        suggest([]);
      }
    })();
  });
  browser.omnibox?.onInputEntered.addListener((content, disposition) => {
    if (!cachedSettings.omniboxEnabled) return;
    void handleOmniboxEnter(content, disposition).catch((error) =>
      logDegraded('background', '地址栏回车处理失败', error)
    );
  });
  browser.omnibox?.onInputStarted.addListener(() => {
    if (!cachedSettings.omniboxEnabled) return;
    void browser.omnibox
      .setDefaultSuggestion({
        description: t('输入关键词以搜索标签、固定与文件夹')
      })
      .catch((error: unknown) => {
        logDegraded('background', '地址栏默认建议写入失败', error);
      });
  });

  // action badge：标签事件驱动刷新（500ms 节流）
  refreshBadgeSoon();

  // regroup 模式：openPanelOnActionClick 为 false 时 Chrome 才会派发 onClicked。

  browser.action?.onClicked.addListener(() => {
    void (async () => {
      try {
        const settings = await settingsRepository.read();
        if (settings.actionClickMode !== 'regroup') return;
        const count = await runActionClickRegroup();
        if (count <= 0) {
          // 「后台整理」模式没有面板承载反馈，整理出 0 个时给一条结果通知（成功走角标 ✓）。
          notifyUser('Tabs', t('没有可整理的标签'));
          return;
        }
        // 角标短暂显示完成标记，到期后恢复设置对应的真实状态。
        showBadgeOverride('✓', BADGE_DONE_COLOR, BADGE_DONE_TTL_MS);
      } catch (error) {
        logDegraded('background', '工具栏点击处理失败', error);
      }
    })();
  });

  // 自动休眠/定时自动快照：alarms 保活调度，MV3 SW 回收后仍可触发。
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_DISCARD_ALARM) void runAutoDiscard();
    if (alarm.name === AUTO_SNAPSHOT_ALARM) void runAutoSnapshot();
  });
  // 仅在开启时创建闹钟（关闭时不让 SW 空跑）；SW 启动按当前设置对齐一次。
  void settingsRepository
    .read()
    .then((settings) => syncAlarms(settings))
    .catch((error: unknown) => {
      logDegraded('background', '启动时闹钟对齐失败（无法同步自动休眠与自动快照闹钟）', error);
    });
});
