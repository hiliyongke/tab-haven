import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
import { getTab, mapTab, moveTab, queryWindowTabs, setPinned } from '@/platform/tabs';
import { installGlobalErrorHandlers, logDegraded } from '@/platform/diagnostics';
import { openOptionsPage } from '@/platform/navigation';
import { openSidePanel, setActionClickBehavior } from '@/platform/sidePanel';
import { setSnapshotEvictionListener } from '@/platform/snapshot/snapshots';
import { toUndoTabRecord } from '@/core/undo/UndoStack';
import { normalizeHostname } from '@/core/url/hostname';
import { foldersRepository, settingsRepository } from '@/platform/storage/repositories';
import { initHeadlessI18n, t } from '@/i18n/headless';
import { createPersistedAllowanceLedger } from '@/platform/reuse/persistedLedger';
import { MessageSchema, REUSE_CLOSED_LIMIT, sendMessage } from '@/platform/messages';
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
  setupMenus,
  type AddEntryResult
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
  recordActiveTab,
  getLastActiveTabId
} from '@/platform/background/windowCache';

export default defineBackground(() => {
  /**
   * 窗口缓存关心的 onUpdated 字段（与 windowCache collectTabs 的采集口径一致：
   * url/title/favIconUrl/pinned/muted/group）。
   */
  const WINDOW_CACHE_UPDATE_KEYS = ['url', 'title', 'favIconUrl', 'pinned', 'mutedInfo', 'groupId'];

  /**
   * 自动分组关心的 onUpdated 字段（字段口径与引擎维护的不变量一一对应）：
   *  - url / pendingUrl / status：域名就绪（新标签打开后第一帧往往只有 pendingUrl）；
   *  - groupId：标签入组 / 被移出 / 组解散（用户手动操作后也要重新对账）；
   *  - pinned：固定标签不参与站点聚合。
   * 刻意不含 title / favIconUrl：标题动画类站点会持续触发，自动分组不受其影响。
   */
  const AUTO_GROUP_UPDATE_KEYS = ['url', 'pendingUrl', 'groupId', 'pinned', 'status'];

  // 全局异常兜底：background 的 alarms / omnibox / contextMenus / 关窗缓存等
  // 异步路径漏网的 rejection，否则在诊断里一条线索都不会留。
  installGlobalErrorHandlers();

  /**
   * 后台侧快照淘汰的告知出口。
   *
   * `setSnapshotEvictionListener` 的唯一注册方是 `snapshotStore`，而它只存在于面板
   * 上下文 —— SW 里没人注册，于是关窗自动保存 / 定时快照触发的淘汰**完全没有知会
   * 用户**：用户只在打开列表时发现旧快照不见了。
   * 与自动休眠同口径：后台静默行为改变了用户数据时，发一次系统通知。
   */
  setSnapshotEvictionListener((count) => {
    notifyUser('Tabs', t('快照超出保留上限，已淘汰最旧的 {{count}} 份', { count }));
  });

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
      activate: async (tabId) => {
        await browser.tabs.update(tabId, { active: true });
      },
      close: (tabId) => browser.tabs.remove(tabId),
      // 复用通知经 runtime 消息推给面板（无面板时静默丢弃）。
      notifyReuse: () => {
        if (!cachedSettings.reuseNotifyEnabled) return;
        sendMessage({ type: 'duplicate-reused' });
      },
      // 复用关闭的标签快照回传面板登记撤销（同网址唯一化默认开启，这条关闭
      // 路径也要进撤销栈）。刻意与 notifyReuse 分开：撤销登记不受
      // 「重复合并提示」开关影响，关掉提示也必须能撤销。
      reportClosed: (windowId, closed) => {
        void (async () => {
          // 组名必须随快照一起回传：撤销恢复时若只有 groupId 而没有组名做校验，
          // 会拿旧 id 直接入组，而该 id 可能已被浏览器复用为无关组。
          // 查询失败不得伪装成「没有组」：那等价于交出一张空组名表，恢复侧只能
          // 盲入旧 id。降级可以，但必须留痕 —— 否则「撤销回来进错了组」无从查起。
          const groups = await browser.tabGroups.query({ windowId }).catch((error) => {
            logDegraded('background', `窗口 ${windowId} 原生组查询失败，撤销记录缺组名`, error);
            return [];
          });
          const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
          const records = closed.map((tab) => toUndoTabRecord(tab, groupNameById));
          // 协议层对单条消息的标签数有上限（防无界传输面）。原样发送超限数据会让
          // 整条消息被 schema 拒绝并静默丢弃 —— 这一批关闭就此彻底无法登记撤销，
          // 而同网址唯一化是默认开启的能力。超限按上限截断并留痕，宁可少记几条
          // 也不能让整批失去撤销出口。
          const tabs = records.slice(0, REUSE_CLOSED_LIMIT);
          if (records.length > tabs.length) {
            logDegraded(
              'background',
              `同网址合并一次关闭 ${records.length} 条，超出单条回执上限，已截断为 ${tabs.length} 条`
            );
          }
          sendMessage({ type: 'reuse-closed', windowId, tabs });
        })();
      }
    },
    { allowances: allowanceLedger, allowancesReady: allowanceLedgerReady }
  );

  // 同 URL 唯一化开关联动（设置存储在 chrome.storage.local）。
  const syncCoordinatorEnabled = async () => {
    try {
      const settings = await settingsRepository.read();
      coordinator.setEnabled(settings.uniqueUrlTabs);
    } catch (error) {
      // 读取失败保持当前状态 —— 但必须留痕：ReuseCoordinator 是 fail-closed 的，
      // 启动读失败会让「同网址唯一化」静默失效整整一个会话（watch 只在设置变更时
      // 触发），而设置页不会自己变。与同文件其它启动路径同口径：静默吞错会让
      // 「设置了却没生效」完全无从排查。
      logDegraded(
        'background',
        '启动时读取同网址唯一化开关失败，本轮维持关闭（fail-closed）',
        error
      );
    }
  };
  void syncCoordinatorEnabled();
  /**
   * 闹钟签名（上一次真正重建闹钟时的设置摘要）。
   *
   * 同名 `alarms.create` 会**重置**触发时间：无条件重建等于把「每 N 分钟一次」的
   * 自动快照无限期推后（实测会永远触发不了）。而设置写入远比开关变更频繁——切空间
   * 写 `activeSpaceId`、引导标记 `tipSeen` / `onboarded` 都走 settingsRepository.watch。
   * 故两个闹钟各自只在其输入变化时才重建：自动休眠只看开关，自动快照只看
   * 「开关 + 周期」——其余设置（排序、空间、引导标记、角标模式等）一概不触碰闹钟。
   */
  let discardAlarmEnabled: boolean | undefined;
  let snapshotAlarmSignature: string | undefined;

  /** 按设置对齐两个周期闹钟；各自的输入未变则跳过重建（见上）。 */
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

  // 设置缓存：SW 启动读一次（badge/通知/菜单/omnibox 共用；变更经 watch 更新）。
  // 读回后补刷一次角标：冷启动 500ms 定时器先触发时 cachedSettings 仍是默认值，
  // 角标会按默认模式渲染且无自愈路径（要等下一次标签事件/设置变更才纠正）。
  // 补刷走**直刷**而非防抖版：防抖版在 500ms 定时器仍在途时会被
  // `if (badgeTimer) return` 直接吞掉，冷启动这次纠正就此丢失（角标会一直停在
  // 默认模式渲染的结果上，要等下一次标签事件才碰巧恢复）。
  void syncCachedSettings().then(() => refreshBadge());

  /**
   * 自动分组的启动对账。
   *
   * 必要性：SW 每次被回收后重新拉起、浏览器每次启动，都可能存在「已经满足聚合
   * 条件但没有分组」的存量标签（旧版本遗留、上次关闭开关后重开、SW 在写组前被回收）。
   * 面板侧驱动被移除后，没有其它补齐入口了 —— 这里读一次开关并按需全窗口对账。
   * 幂等：只为尚无 groupId 的标签建组，重复调用不会产出重复组。
   */
  void settingsRepository
    .read()
    .then((settings) => applyAutoGroupSetting(settings))
    .catch((error: unknown) => logDegraded('auto-group', '启动读取自动分组设置失败', error));

  /**
   * 工具栏图标点击行为（settings.actionClickMode）：
   *  - 'panel'（默认）：Chrome 直接打开侧边栏（openPanelOnActionClick）；
   *  - 'regroup'：不弹面板，改为在 onClicked 里后台整理临时区标签。
   * setPanelBehavior 不跨浏览器会话持久，SW 每次唤醒/设置变更都要对齐一次；
   * 读取实时设置而非共享缓存，避开 SW 刚唤醒时缓存尚未就绪的窗口。
   */
  async function syncActionClickBehavior(): Promise<void> {
    // 读实时设置而非共享缓存：SW 刚唤醒时 cachedSettings 尚未就绪（与
    // enforceNewTabPosition 同口径）。读取失败退化为「打开侧边栏」这一默认行为。
    const settings = await settingsRepository.read().catch(() => undefined);
    await setActionClickBehavior(settings?.actionClickMode !== 'regroup');
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
      // 读实时设置而非共享缓存：SW 刚唤醒时 cachedSettings 尚未就绪，
      // 冷启动后的第一次新建会被按默认值 'end' 静默放过（与 actionClickMode 同口径）。
      const settings = await settingsRepository.read();
      if (settings.newTabPosition !== 'after-active') return;
      if (tab.id === undefined || tab.windowId === undefined) return;
      if (tab.pinned) return;
      let anchorId = getLastActiveTabId(tab.windowId);
      if (anchorId === undefined) {
        // 冷启动锚点补种：SW 回收后 lastActiveTabIds 是空内存态，首个新标签
        // 创建早于窗口缓存初始化时锚点缺失。
        // 此时新标签已被 Chrome 激活，query active 拿不到旧锚点——退而取窗口中
        // 除新标签外的最后一个普通标签作为近似锚点，并顺手补种。
        const siblings = await queryWindowTabs(tab.windowId);
        const fallback = siblings
          .filter((candidate) => candidate.id !== tab.id && !candidate.pinned)
          .sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0];
        if (typeof fallback?.id === 'number') anchorId = fallback.id;
      }
      if (anchorId === undefined || anchorId === tab.id) return;
      const anchor = await getTab(anchorId);
      if (!anchor || anchor.windowId !== tab.windowId || anchor.index === undefined) return;
      const target = anchor.index + 1;
      if (tab.index === target) return;
      await moveTab(tab.id, target, tab.windowId);
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
    // 自动分组在标签「出生」这一帧就登记：Chrome 会把从组内标签点开的新标签
    // 直接塞进同一个组，越早对账，用户越看不到「先错组、再跳出」的过程。
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
    // 仅窗口缓存采集口径内的字段变化才刷新缓存：标题动画/计时器类站点的高频
    // onUpdated 会让 SW 每 600ms 做一次全窗口 query + session 落盘，SW 永远无法
    // 空闲回收（与 UI 侧 RELEVANT_UPDATE_KEYS 同一思路，两处口径各自匹配自家消费方）。
    if (
      typeof tab.windowId === 'number' &&
      WINDOW_CACHE_UPDATE_KEYS.some((key) => key in changeInfo)
    ) {
      scheduleWindowRefresh(tab.windowId);
    }
    // 域名就绪 / 入组状态变化 → 自动分组对账（120ms 合并，与上面的窗口缓存各自独立）。
    if (AUTO_GROUP_UPDATE_KEYS.some((key) => key in changeInfo)) {
      scheduleAutoGroupReconcile(tab.windowId);
    }
  });
  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    coordinator.handleRemoved(tabId);
    refreshBadgeSoon();
    // 与相邻的 onAttached / onDetached 同口径：windowId 缺失时 scheduleWindowRefresh
    // 会按 undefined 建键，缓存里多出一个永不清理的幽灵窗口。
    if (typeof removeInfo.windowId === 'number') scheduleWindowRefresh(removeInfo.windowId);
    // 少一个标签可能让分组回到阈值以下，也可能让某个自动组变空被回收。
    scheduleAutoGroupReconcile(removeInfo.windowId);
  });
  browser.tabs.onAttached.addListener((_tabId, attachInfo) => {
    if (typeof attachInfo.newWindowId === 'number') scheduleWindowRefresh(attachInfo.newWindowId);
    // 跨窗口移动：目标窗口的成员构成变了（源窗口由 onDetached 覆盖），重新对账。
    scheduleAutoGroupReconcile(attachInfo.newWindowId);
  });
  browser.tabs.onDetached.addListener((_tabId, detachInfo) => {
    if (typeof detachInfo.oldWindowId === 'number') scheduleWindowRefresh(detachInfo.oldWindowId);
    scheduleAutoGroupReconcile(detachInfo.oldWindowId);
  });
  // 预渲染置换：旧标签被新标签替换（无 onCreated/onRemoved 对），
  // 需显式结算旧任务并把新标签纳入追踪，否则窗口标签缓存与复用追踪短暂失真。
  browser.tabs.onReplaced?.addListener((addedTabId, removedTabId) => {
    coordinator.handleRemoved(removedTabId);
    void (async () => {
      try {
        const tab = await getTab(addedTabId);
        if (!tab) return;
        coordinator.handleCreated(tab);
        if (typeof tab.windowId === 'number') scheduleWindowRefresh(tab.windowId);
      } catch (error) {
        // 标签在置换后瞬间又被关闭时 get 失败：留痕即可，复用追踪缺口是
        // 一次性漏判，不必当成故障处理。
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
    // 来源校验：当前版本没有 externally_connectable / content_scripts /
    // web_accessible_resources，外部网页无法投递消息；但端点一旦放开就会立刻暴露
    // （如 allow-duplicate-once 能改变去重行为），故在此前置拦截。
    //
    // 用 `sender?.id` 而非 `sender.id`：宿主一定会传 sender，但任何单参数调用
    // （测试桩 / polyfill）会在读 sender.id 时抛 TypeError，而异常发生在监听器内
    // 会直接吞掉整条消息通道（与 platform/messages.ts 的 onRuntimeMessage 同款防护）。
    if (sender?.id !== undefined && sender.id !== browser.runtime.id) return;

    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.type) {
      case 'settings-synced':
        void syncCachedSettings();
        // 必须响应：不响应会让发送方的 await 一直挂到超时。
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

  // 浏览器级快捷键命令分发
  browser.commands?.onCommand.addListener(async (command) => {
    // 监听器保持 async：调用方（含测试）可 await 到命令真正执行完。
    // 代价是返回的 promise 若 reject 无人接住会变成无归属的 unhandled
    // rejection（用户只看到「按了快捷键没反应」），故内部自行兜住异常。
    try {
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
    } catch (error) {
      logDegraded('background', `快捷键命令执行失败：${command}`, error);
    }
  });

  /**
   * 卸载挽留。
   *
   * 卸载扩展会连同 chrome.storage.local 一起删除固定空间、快照与归档和
   * 撤销栈 —— 而 Tabs 没有服务器，卸载后无从找回。用户点击「移除」时必须得到提示，
   * 否则这是一条单向的、不可挽回的数据丢失路径。
   *
   * 两条硬约束（与「零出站网络 / 无遥测」的承诺一致）：
   *   1. 目标页必须随扩展打包到本地（public/uninstall-backup.html 会被原样拷进
   *      产物），样式全部内联 —— 任何外部字体/CDN/图片都会击穿隐私门禁；
   *   2. URL 不带任何查询参数回传 —— 否则「用户卸载了」这件事本身就被上报，
   *      构成事实上的遥测。
   */
  const registerUninstallUrl = (): void => {
    try {
      // setUninstallURL 只接受**完整 URL**：传相对路径会被浏览器直接抛 Invalid URL。
      // 该 API 返回 Promise，rejection 不走下面的 try/catch（那只兜同步异常），
      // 故必须另外 .catch，否则 SW 控制台会出现「未处理的 Promise rejection」。
      // 用 getURL 解析为 chrome-extension://<id>/uninstall-backup.html：仍指向扩展自身
      // 页面，不指向任何外部站点，也不带查询参数。
      void browser.runtime
        .setUninstallURL(browser.runtime.getURL('/uninstall-backup.html'))
        .catch((error) => {
          // 该 API 在个别环境下不可用（非 Chrome/Edge 内核）：挽留是尽力而为，
          // 失败不影响主流程 —— 但原因必须留痕，否则「卸载时没看到备份提醒」
          // 在诊断导出里查不到任何线索。
          logDegraded('background', '卸载挽留页注册失败，用户卸载时将不会看到数据备份提醒', error);
        });
    } catch (error) {
      // 同步兜底（API 不存在等非标准环境）：失败不影响主流程，同样要留痕。
      logDegraded('background', '卸载挽留页注册失败（同步异常）', error);
    }
  };

  browser.runtime.onInstalled.addListener(() => {
    void syncActionClickBehavior();
    void setupMenus();
    registerUninstallUrl();
  });
  browser.runtime.onStartup.addListener(() => {
    void syncActionClickBehavior();
    void setupMenus();
    // SW 每次被回收后重新拉起时 URL 需重新注册（浏览器不保证跨会话保留）。
    registerUninstallUrl();
  });
  // 文件夹变化时刷新菜单子项（SW 存活期间）
  foldersRepository.watch((folders) => {
    if (cachedSettings.contextMenusEnabled) rebuildContextMenus(folders);
    else clearContextMenus();
  });
  // 设置变更：缓存更新 + 右键菜单开关联动（开关重新打开时按当前文件夹重建）
  // + 角标即时刷新 + 自动休眠闹钟启停 + 工具栏点击行为切换 + 自动分组开关联动
  settingsRepository.watch((settings) => {
    void syncCachedSettings();
    coordinator.setEnabled(settings.uniqueUrlTabs);
    if (settings.contextMenusEnabled) void setupMenus();
    else clearContextMenus();
    // 自动休眠 / 自动保存的开关与间隔变更即时对齐闹钟（周期变化也需重建，
    // alarms 无法就地改周期）。与闹钟无关的设置写入不重建（见 alarmSignature）。
    void syncAlarms(settings);
    void syncActionClickBehavior();
    // 开启即补齐存量标签；关闭即解散本功能创建的组。聚合模式 / 阈值变化同样
    // 经此重新对账 —— 三者是「自动组内同站点」这条不变量的全部输入。
    applyAutoGroupSetting(settings);
    refreshBadgeSoon();
  });

  /**
   * 右键「加入文件夹」的结果反馈。
   *
   * 成功也必须反馈（MV3 上下文菜单动作必须有用户可感知的确认）：只在失败时通知，
   * 用户点完不知道到底存没存。三态各发一条，避免「写入失败」被统一
   * 说成「已在文件夹中」这种与事实相反的表述。
   */
  const notifyAddToFolderResult = (result: AddEntryResult): void => {
    if (result === 'failed') return; // 失败通知已由 addEntryToFolder 内部发出
    notifyUser('Tabs', t(result === 'added' ? '已保存到收藏夹文件夹' : '这个网址已经在文件夹里了'));
  };

  browser.contextMenus?.onClicked.addListener((info, tab) => {
    const id = info.menuItemId as string;
    if (id.startsWith('th:page:add-folder:') || id.startsWith('th:link:add-folder:')) {
      const folderId = id.split(':').at(-1);
      if (!folderId) {
        // 菜单 id 由本模块拼装（th:*:add-folder:<folderId>），解析不出 id 说明
        // 拼装侧与解析侧已经不一致；静默 return 会让这个右键项彻底无声失效。
        logDegraded('background', `右键菜单 id 无法解析出文件夹 id：${id}`);
        return;
      }
      if (id.startsWith('th:link:')) {
        if (info.linkUrl) {
          void addEntryToFolder(folderId, {
            url: info.linkUrl,
            title: info.selectionText || info.linkUrl
          }).then((result) => notifyAddToFolderResult(result));
        }
      } else if (tab?.url) {
        void addEntryToFolder(folderId, {
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl
        }).then((result) => notifyAddToFolderResult(result));
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
      // 标签栏右键的「固定」与页面右键同一处理分支：两处都是把目标标签
      // 写进固定图标区并置 pinned，语义完全一致，不复制一份分支。
      case MENU_IDS.tabPin:
      case MENU_IDS.pagePin: {
        if (targetTab?.url && targetTab.id !== undefined) {
          // 写路径只此一处：`addPinFromTab` 内含上限预检（PINS_LIMIT）与失败留痕，
          // 与面板的 addPin 同口径。此前这里另写了一份「读 → 合并 → 写」，绕过上限
          // 预检：超限仍能写成功，而导出的备份在导入时被 `.max(PINS_LIMIT)` 整批拒绝，
          // 用户只看到「备份文件无效」且诊断查不到原因。
          void (async () => {
            const pinned = await addPinFromTab({
              url: targetTab.url,
              title: targetTab.title
            });
            if (pinned && !targetTab.pinned && targetTab.id !== undefined) {
              await setPinned(targetTab.id, true);
            }
            // 成功也要有反馈：只在失败时通知，用户点「固定」后无法确认是否生效。
            // 与 addEntryToFolder 同口径：按真实结果反馈，不假设成功。
            notifyUser('Tabs', t(pinned ? '已加入常驻磁贴。' : '加入常驻磁贴失败，请重试。'));
          })().catch((error: unknown) => {
            // 锁请求被中止（AbortError）、仓库读失败都会走到这里。不接住的话：
            // ① 变成一次 unhandled rejection（SW 侧无 UI 可承载）；
            // ② 用户点了「固定」却一条通知都收不到，与「点了没反应」无法区分。
            logDegraded('background', '加入常驻磁贴失败', error);
            notifyUser('Tabs', t('加入常驻磁贴失败，请重试。'));
          });
        }
        break;
      }
      case MENU_IDS.pageSearchSite:
      case MENU_IDS.tabSearchSite: {
        const host = hostnameOf(targetTab?.url);
        // 与地址栏搜索共用「先开面板再入队」路径：只入队时面板未打开，动作
        // 仅落 session 队列，用户点了菜单却看不到任何反应。
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

  // omnibox：t <关键词>（omniboxEnabled 开关）
  //
  // 刻意**不加防抖**：`suggest` 是 omnibox 协议里必须被调用的一次性回调，不调用则
  // 地址栏永久停在「等待建议」。此前把它塞进 120ms 的裸 setTimeout —— SW 在防抖
  // 窗口内被回收时，定时器连同 suggest 引用一起消失，这一次建议再也补不回来
  // （用户已经敲完这个字符）。与 badge 同口径：关键状态不能寄托在裸定时器上。
  // 查询是本地全量扫描（无网络），少一次防抖的代价远小于一次永久挂起。
  browser.omnibox?.onInputChanged.addListener((text, suggest) => {
    if (!cachedSettings.omniboxEnabled) {
      suggest([]);
      return;
    }
    // 必须兜底：queryOmnibox reject 时若不调用 suggest，地址栏会永久停在
    // 「等待建议」的状态，同时留下一条无处可见的未捕获 rejection。
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
    // 与 onInputEntered 同口径：默认建议写入失败若不接住，会留下一条无归属的
    // unhandled rejection（地址栏表现为默认建议缺一行，无可排查线索）。
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

  // regroup 模式：openPanelOnActionClick 为 false 时 Chrome 才会派发 onClicked，
  // 两种点击方式由设置驱动的 behavior 切换实现并存。
  // 「整理完成」角标反馈的色值与时长。
  // 色值只能写死：chrome.action 的 badge 背景色只接受 CSS 颜色字符串，
  // 读不到设计令牌/CSS 变量（这是浏览器 API 的边界，不是绕过设计系统的口子）。
  const BADGE_DONE_COLOR = '#16a34a';
  const BADGE_DONE_TTL_MS = 1500;

  browser.action?.onClicked.addListener(() => {
    void (async () => {
      try {
        const settings = await settingsRepository.read();
        if (settings.actionClickMode !== 'regroup') return;
        const count = await runActionClickRegroup();
        if (count <= 0) {
          // 「后台整理」模式下没有面板承载反馈，整理出 0 个标签时用户点完图标
          // 什么都不会发生 —— 与「整理失败」无法区分。给一条说明结果的通知
          // （整理成功走下面轻量的角标 ✓，不打扰）。
          notifyUser('Tabs', t('没有可整理的标签'));
          return;
        }
        // 轻量完成反馈：角标短暂打勾（无文案噪音），随后按设置恢复正常角标。
        // 走 badge 模块的带到期时间的覆盖态：裸 setTimeout 在 SW 被回收后不会
        // 触发，角标会永久停在 ✓。
        showBadgeOverride('✓', BADGE_DONE_COLOR, BADGE_DONE_TTL_MS);
      } catch (error) {
        logDegraded('background', '工具栏点击处理失败', error);
      }
    })();
  });

  // 自动休眠：白名单 + 台账 + 通知（alarms 保活调度，MV3 SW 回收后仍可触发）
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_DISCARD_ALARM) void runAutoDiscard();
    // 定时自动快照：兜住「崩溃 / 强制退出 / 长期不关窗」这些关窗保存覆盖不到的场景。
    if (alarm.name === AUTO_SNAPSHOT_ALARM) void runAutoSnapshot();
  });
  // 仅在开启时创建闹钟（关闭时不让 SW 空跑）；SW 启动按当前设置对齐一次。
  void settingsRepository
    .read()
    .then((settings) => syncAlarms(settings))
    // 与同文件其它启动路径同口径：静默吞错会让「闹钟没对齐」完全无从排查。
    .catch((error: unknown) => {
      logDegraded('background', '启动时闹钟对齐失败（自动休眠/自动快照本轮不生效）', error);
    });
});
