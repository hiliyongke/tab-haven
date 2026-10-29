import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DuplicateIndex } from '@/core/dup/DuplicateIndex';
import { planRegroup } from '@/core/group/AutoGrouping';
import { canSafelyDiscardTab, NO_GROUP } from '@/core/tab-types';
import {
  planDuplicateCleanup,
  selectArchivableTabs,
  selectSleepableTabs
} from '@/core/tabSelectors';
import type { TabRecord } from '@/core/tab-types';
import { DEFAULT_FOLDER_NAMES } from '@/core/snapshot/defaultNames';
import type { TemporarySection } from '@/core/site/Sections';
import { buildRoamOrder } from '@/core/site/roamOrder';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import {
  activateTabAcrossWindows,
  createTabsWithUrls,
  detectLanguage,
  moveTab,
  onTabHighlighted,
  reloadTabs
} from '@/platform/tabs';
import { downloadJsonFile, openAboutPage, openOptionsPage } from '@/platform/navigation';
import { onRuntimeMessage } from '@/platform/messages';
import { datedJsonFilename } from '@/core/util/filename';
import {
  readAutoDiscardBatches,
  removeAutoDiscardBatch
} from '@/platform/storage/autoDiscardLedger';
import { logDegraded, logFailure } from '@/platform/diagnostics';
import { regroupTempArea } from '@/platform/group/AutoGroupSync';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { translate, useTranslation } from '@/i18n';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { Button } from '@/ui/common/Button';
import { Icon, Icons } from '@/ui/common/Icon';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { StatusToast } from '@/ui/common/StatusToast';
import { UndoHistoryPanel } from '@/ui/common/UndoHistoryPanel';
import { SnapshotsPanel } from '@/ui/snapshot/SnapshotsPanel';
import { OnboardingTour } from '@/ui/common/OnboardingTour';
import { CommandPalette, type PaletteActions } from '@/ui/panels/CommandPalette';
import { SpaceStrip } from '@/ui/common/SpaceStrip';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { DndRoot } from '@/ui/dnd/DndRoot';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { useBatchTabActions } from '@/entrypoints/sidepanel/hooks/useBatchTabActions';
import { usePanelLayers } from '@/ui/hooks/usePanelLayers';
import { useLatestRef } from '@/ui/hooks/useLatestRef';
import { useRowRoving } from '@/ui/hooks/useRowRoving';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { FixedArea } from '@/ui/fixed/FixedArea';
import { PinnedStrip } from '@/ui/fixed/PinnedStrip';
import { SearchBar } from '@/ui/search/SearchBar';
import { SectionList, splitPartnerIds } from '@/ui/tabs/SectionList';
import { useLocateActive } from '@/ui/hooks/useLocateActive';
import { useSearchController } from '@/ui/search/useSearchController';
import { HistoryHitsSection } from '@/ui/search/HistoryHitsSection';
import { useSectionDerivation } from '@/entrypoints/sidepanel/hooks/useSectionDerivation';
import { useGlobalHotkeys } from '@/ui/hooks/useGlobalHotkeys';
import { useSpaces } from '@/entrypoints/sidepanel/hooks/useSpaces';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';
import { useOtherWindows } from '@/ui/tabs/useOtherWindows';
import { OtherWindowsSection } from '@/ui/tabs/OtherWindowsSection';
import { RestoreConfirmDialog } from '@/ui/snapshot/RestoreConfirmDialog';
import type { Snapshot } from '@/core/schema/models';
import { useListNavigation } from '@/ui/hooks/useListNavigation';
import { usePendingActions } from '@/entrypoints/sidepanel/hooks/usePendingActions';
import { SortablePinnedTile } from '@/ui/tabs/SortablePinnedTile';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { Callout } from '@/ui/common/Callout';
import { FooterToolbar } from '@/entrypoints/sidepanel/FooterToolbar';
import { computeInsights } from '@/core/insights/tabInsights';
import {
  EmptyTabs,
  LoadErrorState,
  LoadingSkeleton,
  NoSearchResults
} from '@/ui/common/ListStates';
import { useTabDragHandlers } from '@/ui/hooks/useTabDragHandlers';

/** 初始化失败后的自动重试延迟：给仓库读取一次喘息，避免在同一故障上立刻重试。 */
const INIT_RETRY_DELAY_MS = 1000;
/** 自动重试次数上限（含首次）。用尽即转错误态，交回用户手动重试。 */
const INIT_MAX_ATTEMPTS = 2;
/** 首启引导延迟：数据就绪后先让用户看到真实列表，避免遮罩盖住被介绍对象。 */
const TOUR_AUTO_OPEN_DELAY_MS = 900;

export default function App() {
  const { t } = useTranslation();

  const tabs = useTabStore((state) => state.tabs);
  const tabSyncReady = useTabStore((state) => state.tabSyncReady);
  const groups = useTabStore((state) => state.groups);
  const activateTab = useTabStore((state) => state.activateTab);
  const toggleMute = useTabStore((state) => state.toggleMute);
  const togglePinned = useTabStore((state) => state.togglePinned);
  const duplicateTab = useTabStore((state) => state.duplicateTab);
  const discardTab = useTabStore((state) => state.discardTab);
  const setGroupCollapsed = useTabStore((state) => state.setGroupCollapsed);
  const createFolderFromNativeGroup = useDataStore((state) => state.createFolderFromNativeGroup);
  const createNewTab = useTabStore((state) => state.createNewTab);
  const highlightedIds = useTabStore((state) => state.highlightedIds);
  const setHighlighted = useTabStore((state) => state.setHighlighted);
  const renameGroup = useTabStore((state) => state.renameGroup);
  const recolorGroup = useTabStore((state) => state.recolorGroup);
  const startTabSync = useTabStore((state) => state.startTabSync);
  const initializeData = useDataStore((state) => state.initialize);
  const tryUpdateSettings = useDataStore((state) => state.tryUpdateSettings);
  const dataReady = useDataStore((state) => state.ready);
  const boundTabIds = useDataStore((state) => state.boundTabIds);
  const folders = useDataStore((state) => state.folders);
  const settings = useDataStore((state) => state.settings);
  const collapsedSites = useDataStore((state) => state.collapsedSites);
  // 落盘失败必须被看见：否则界面显示成功、重启即丢，是信任事故。
  const storageDegraded = useDataStore((state) => state.storageDegraded);
  const toggleSiteCollapsed = useDataStore((state) => state.toggleSiteCollapsed);
  const reconcileWithTabs = useDataStore((state) => state.reconcileWithTabs);
  const loadUndo = useUndoStore((state) => state.load);
  const closeWithUndo = useUndoStore((state) => state.closeWithUndo);
  const notify = useUndoStore((state) => state.notify);
  const notifyError = useUndoStore((state) => state.notifyError);
  const undoBatchCount = useUndoStore((state) => state.batches.length);
  const snapshotCount = useSnapshotStore((state) => state.snapshots.length);
  /** 完整快照列表（时间线搜索索引源；仅引用变化时重建引擎）。 */
  const snapshots = useSnapshotStore((state) => state.snapshots);

  const [quickRegrouping, setQuickRegrouping] = useState(false);
  /** 批量动作闭环整块在 useBatchTabActions，App 只把三个回调接到底栏与命令面板。 */
  const { batchBusy, discardInactive, wakeAll, closeDuplicates } = useBatchTabActions({
    t,
    boundTabIds,
    discardTab,
    closeWithUndo
  });
  /** 弹层互斥收在 usePanelLayers：三个覆盖层同时只开一层，快照初始视图随「打开」指定。 */
  const { layer, openHistory, openPalette, openSnapshots, closeLayer } = usePanelLayers();
  const showHistory = layer.kind === 'history';
  const showPalette = layer.kind === 'palette';
  const showSnapshots = layer.kind === 'snapshots';
  const snapshotView = layer.kind === 'snapshots' ? layer.view : 'list';
  // 工作区切换：编排逻辑抽在 hook，App 只消费结果。
  const {
    spaces,
    activeSpaceId,
    switching,
    pendingSwitch,
    switchSpace,
    confirmSwitch,
    cancelSwitch,
    exitSpace,
    saveAsSpace
  } = useSpaces();
  const handleOtherWindowFocus = useCallback((tab: TabRecord) => {
    void activateTabAcrossWindows({ id: tab.id, windowId: tab.windowId });
  }, []);
  const handleOtherWindowClose = useCallback((tab: TabRecord) => {
    // 走统一撤销批次：误关其他窗口标签与误关当前标签同一找回体验。
    void useUndoStore.getState().closeWithUndo([tab], [tab.id]);
  }, []);
  /** 底栏按钮拖拽后的顺序写回（组件不碰存储，持久化在这里）。 */
  const handleReorderFooter = useCallback(
    (order: string[]) => void useDataStore.getState().tryUpdateSettings({ footerOrder: order }),
    []
  );

  /** 把其他窗口的标签搬进当前窗口（index -1 = 末尾）。 */
  const handlePullToWindow = useCallback(
    (tab: TabRecord) => {
      const { currentWindowId } = useTabStore.getState();
      if (currentWindowId === undefined) return;
      void Promise.resolve(moveTab(tab.id, -1, currentWindowId)).then((ok) =>
        notify(ok ? t('已拉到当前窗口') : t('操作失败，请稍后重试'))
      );
    },
    [notify, t]
  );

  // 历史命中恢复的待确认快照（与快照面板/命令面板同一闸门）。
  const [pendingHistoryRestore, setPendingHistoryRestore] = useState<Snapshot | null>(null);
  /**
   * 待确认的「归档当前窗口」（影响面 = 将被关闭的标签数）。
   * 归档是一次性关掉整个窗口的破坏性动作，而恢复（同样是新建整批标签）反而
   * 强制确认 —— 危险操作确认力度必须对称。归档不是高频动作，加确认不构成摩擦。
   */
  const [pendingArchiveCount, setPendingArchiveCount] = useState<number | null>(null);
  // 引导延迟挂载：让用户先看到真实列表一眼，再弹出介绍（边看边学）。
  const [showTour, setShowTour] = useState(false);
  // 数据初始化自动重试仍失败：从骨架屏转为错误态（说明 + 手动重试），
  // 否则用户会永久停在一个没有出口的骨架屏上。
  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * 用户是否已接管滚动（防"抢滚"）：一旦手动滚动浏览，就**不再**把视图自动拉回
   * 激活标签，直到用户显式表达「我要看激活标签」（点击标签切换 / ⌘J 定位）为止。
   *
   * 不用「静默期」：静默一过就会再次跟随，而用户往往正停在半路找另一个标签，
   * 被拉回去是纯粹的干扰。
   *
   * 必须用 state 而非 ref：ref 变化不触发重渲染，而本值需要下传给 SectionList。
   */
  const [userScrollActive, setUserScrollActive] = useState(false);
  const markUserScroll = useCallback(() => setUserScrollActive(true), []);
  /** 交还滚动跟随权（用户主动切换或定位激活标签时调用）。 */
  const releaseScrollControl = useCallback(() => setUserScrollActive(false), []);

  /**
   * 智能激活：目标标签在其他窗口时先聚焦窗口再激活（全窗口搜索用）。
   *
   * 刻意不依赖 effectiveTabs / currentWindowId：二者在搜索输入时每次都变，
   * 会让 smartActivate → sectionCallbacks → SectionList 的 memo 链整条失效。
   * 改为读取 store 实时值，与同文件其他 handler 的 getState() 写法一致。
   */
  const smartActivate = useCallback(
    (tabId: number) => {
      // 用户主动切换标签 = 明确想看这个标签，交还滚动跟随权。
      releaseScrollControl();
      const { tabs: liveTabs, currentWindowId: liveWindowId } = useTabStore.getState();
      const tab = (liveTabs as TabRecord[]).find((candidate) => candidate.id === tabId);
      if (tab && tab.windowId !== liveWindowId) {
        return activateTabAcrossWindows({ id: tab.id, windowId: tab.windowId });
      }
      return activateTab(tabId);
    },
    [activateTab, releaseScrollControl]
  );

  // 常驻搜索：查询状态 / 引擎 / 命中 / 禁缓存角标集 / 历史命中。
  // 键盘漫游（↑↓/Enter）已拆到 useListNavigation：搜索态与空态共用一套语义。
  const {
    query,
    setQuery,
    clearQuery,
    isFiltering,
    searchInputRef,
    filteredTabs,
    searchHitTabIds,
    noCacheTabIds,
    historyHits,
    handleSearchKeyDown
  } = useSearchController({
    tabs,
    t,
    searchAllWindows: settings.searchAllWindows,
    pinyinSearch: settings.pinyinSearch,
    searchHistory: settings.searchHistory,
    snapshots,
    noCacheEnabled: settings.noCacheEnabled,
    noCachePatterns: settings.noCachePatterns
  });

  /**
   * 过滤态结束（清空搜索 / 关掉历史命中）时把主列表滚回顶部。
   *
   * React 不会替 DOM 节点重置 scrollTop：搜完清空后列表恢复全量，容器却停在
   * 之前的位置，用户会以为「上面的标签丢了」。仅在「由过滤 → 非过滤」这一刻复位，
   * 浏览过程中的滚动不受影响。
   */
  const listScrollRef = useRef<HTMLDivElement>(null);
  /**
   * 原生固定标签区（浏览器置顶）磁贴网格的内滚渐隐。
   *
   * 只加 `.scroll-fade` class 而不接 hook 时，底部 12px 渐隐**常驻**（没有
   * `.is-scrolled-to-end` 去撤掉它），正好盖住第二行磁贴的下半截 —— 看起来
   * 就像磁贴被遮住。必须配对使用。
   */
  const nativePinGridRef = useRef<HTMLDivElement>(null);
  // 用 tabs.length 而非 pinnedSection：后者在本行之后才定义，且固定区只在该
  // 分段存在时渲染 —— 传标签总数足以在「容器出现/内容变化」时重挂监听。
  useScrollFade(nativePinGridRef, tabs.length);
  /** 列表级键盘漫游（↑↓ / Home / End）：算法与 DOM 约定同在 ui/hooks/useRowRoving。 */
  const handleListKeyDown = useRowRoving(listScrollRef);

  const wasFilteringRef = useRef(isFiltering);
  useEffect(() => {
    if (wasFilteringRef.current && !isFiltering) {
      listScrollRef.current?.scrollTo({ top: 0 });
    }
    wasFilteringRef.current = isFiltering;
  }, [isFiltering]);

  const activeTabId = tabs.find((tab) => tab.active)?.id;
  /**
   * 必须 memo 化：`useLocateActive` 把 clearQuery 列进了内部 useCallback 依赖，
   * 这里每渲染一个新箭头函数 → handleLocateActive → 定位/挂起动作链路全部换新引用
   * → 键盘监听、runtime 消息监听、挂起动作监听每次渲染都解绑重绑（本文件大量重渲染）。
   * 副作用还包括：挂起队列监听每次订阅都会异步读一次 session，多个在途读取可能在
   * 队列清除前重复读到同一条动作，导致重复执行。
   */
  const handleLocateActive = useLocateActive({
    activeTabId,
    notify,
    clearQuery
  });

  /**
   * 定位回调的最新值。
   *
   * 它依赖 `activeTabId`，每次切换激活标签都会换新引用。若直接进 effect 依赖，
   * 键盘监听与消息监听会在每次切换标签时解绑/重绑一遍；用 ref 取最新值可让
   * 监听只挂载一次，行为不变。
   */
  const locateActiveRef = useLatestRef(handleLocateActive);

  /**
   * 自动休眠撤销提示：toast + 「全部唤醒」动作（唤醒后清台账）。
   *
   * 文案走 `i18n.t` 而非 `t`：本回调是「面板打开时补提示」effect 的依赖，
   * 用 `t` 会让切换语言重放该 effect —— 表现为重复弹出休眠提示。
   */
  const showDiscardUndoToast = useCallback(
    (batch: { tabIds: number[]; count: number }) => {
      notify(translate('已自动休眠 {{count}} 个标签', { count: batch.count }), {
        label: translate('唤醒这些标签'),
        run: async () => {
          const woken = (await reloadTabs(batch.tabIds)).length;
          // 只清掉这一轮：台账是多批次滚动保留的，整表清空会连带抹掉更早几轮
          // 仍处休眠的标签的唤醒出口。摘除走台账模块的跨页锁，避免与 SW 侧
          // 「追加新批次 / 淘汰失效批次」的整表写互相覆盖。
          await removeAutoDiscardBatch(batch.tabIds);
          useUndoStore.getState().notify(translate('已唤醒 {{count}} 个标签', { count: woken }));
        }
      });
    },
    [notify]
  );

  /** 聚焦并全选搜索框（⌘K 与 focus-search 动作共用同一行为）。 */
  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
    // searchInputRef 是 ref 对象（引用恒定），显式列入依赖无行为差异，仅为满足 lint
  }, [searchInputRef]);
  /** 把域名填入搜索框并聚焦（右键「搜索此域名」经挂起队列到达）。 */
  const searchDomainInPanel = useCallback(
    (next: string) => {
      setQuery(next);
      searchInputRef.current?.focus();
    },
    [setQuery, searchInputRef]
  );
  /**
   * 定位激活标签（快捷键、挂起动作、命令面板共用）。
   * 定位是用户显式「把激活标签带到眼前」，故同时交还滚动跟随权。
   */
  // locateActiveRef 由 useRef 持有、引用恒定，列入依赖不会触发重跑；
  // 不列则 lint 报缺依赖（自定义 hook 的返回值不被识别为 ref）。
  const locateActiveViaRef = useCallback(() => {
    releaseScrollControl();
    locateActiveRef.current();
  }, [locateActiveRef, releaseScrollControl]);
  const notifyDuplicateReused = useCallback(
    () => notify(translate('已切到已打开的标签，并关掉重复的那个')),
    [notify]
  );

  // 挂起动作（面板未开时）与 runtime 消息消费：双通道按 at 去重、回调经 ref 取值，
  // 使 runtime 监听与 session 挂起队列监听只在挂载时注册一次（细则见该 hook 注释）。
  usePendingActions({
    focusSearch: focusSearchInput,
    searchDomain: searchDomainInPanel,
    locateActive: locateActiveViaRef,
    duplicateReused: notifyDuplicateReused,
    discardBatch: showDiscardUndoToast
  });

  // 面板全局快捷键：⌘/Ctrl + P 命令面板、+ J 定位激活标签、+ K 搜索、+ Z 撤销最近关闭。
  useGlobalHotkeys({
    openPalette,
    locateActive: locateActiveViaRef,
    focusSearch: focusSearchInput,
    // undo 内部有执行互斥与空栈静默，键盘连按安全。
    undoLast: () => void useUndoStore.getState().undo(),
    // redo 内部与 undo 共用执行互斥；空重做栈时由 store 自行 notify(undo.redoNone)，
    // 不会出现「按了没反应」。
    redoLast: () => void useUndoStore.getState().redo()
  });

  /** 初始化失败后的自动重试定时器句柄（跨 effect 实例共享，cleanup 才能清到）。 */
  const retryTimerRef = useRef<number | undefined>(undefined);

  // 同步服务：事件 → 快照 → store 订阅自动重渲染。
  // 依赖里刻意不含 `t`：语言切换会导致 t 引用变化，进而重放整个数据层初始化
  // （重读全部仓库 + 重新订阅标签事件），切换一次语言等于重启一次面板。
  useEffect(() => {
    let cancelled = false;
    // 重试定时器句柄必须在 effect 之间共享：局部 `let` 在 StrictMode 双挂载下
    // 只属于当次闭包，第二次挂载的 cleanup 清不到第一次排上的定时器。
    // 初始化失败时 toast 并自动重试一次（dataStore 已回滚 initialized 守卫，允许重入），
    // 避免面板永久停在 Loading 骨架屏。
    // 重试次数是**命名常量**而不是「再嵌一层 catch」：后者把「只重试一次」这个
    // 决定焊死在控制流里，想改成两次只能再加一层嵌套，且每次嵌套都要重写一遍
    // 取消判断与失败处理。
    const attemptInit = (attempt: number): void => {
      void initializeData().catch((error: unknown) => {
        if (cancelled) return;
        // 面板起不来是「用户只看到骨架屏」的故障，必须留痕：重试用尽后
        // 错误态只说「重试」，没有诊断记录就无从判断是存储读失败还是初始化抛错。
        logDegraded('sidepanel', `数据初始化失败（第 ${attempt} 次）`, error);
        if (attempt === 1) notify(translate('数据加载失败，请检查扩展权限'));
        if (attempt < INIT_MAX_ATTEMPTS) {
          retryTimerRef.current = window.setTimeout(
            () => attemptInit(attempt + 1),
            INIT_RETRY_DELAY_MS
          );
          return;
        }
        // 重试次数用尽：转错误态（手动重试 / 重新打开面板），不再静默。
        setLoadFailed(true);
      });
    };
    attemptInit(1);
    void loadUndo().catch((error: unknown) => {
      logFailure('sidepanel', '撤销历史加载失败', error);
    });
    void useSnapshotStore
      .getState()
      .load()
      .catch((error: unknown) => {
        // 失败态由快照面板自己呈现（可重试）；这里只保证不留无归属的 rejection。
        logFailure('sidepanel', '快照加载失败', error);
      });
    const stopSync = startTabSync();
    return () => {
      cancelled = true;
      if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
      stopSync();
    };
  }, [initializeData, loadUndo, startTabSync, notify]);

  // 快照联动：挂起转正 + 绑定维护（固定空间一致性，由入口层编排，
  // 避免 tabStore ↔ dataStore 相互依赖）。
  // dataReady + tabSyncReady 双守卫：初始化完成前 folders 为空、首帧标签
  // 快照未回时 tabs=[]，都不是真实状态——此刻跑绑定协调会把磁盘绑定整表
  // 清空。二者都就绪后补跑首次协调（幂等，无变更不写盘）。
  useEffect(() => {
    if (!dataReady || !tabSyncReady) return;
    void reconcileWithTabs(tabs);
  }, [tabs, reconcileWithTabs, dataReady, tabSyncReady]);

  // 快捷键（useGlobalHotkeys）与 runtime 消息分发（usePendingActions）各自独立成 hook：
  // 挤在同一个 effect 里会让依赖数组带上消息侧回调，切标签 / 语言变化时
  // 快捷键监听被连带解绑重绑。

  // 自动休眠台账：面板打开时若有未撤销批次，提示可一键唤醒。
  // 台账是多批次（滚动保留最近若干轮），这里只补提示最近那一轮 —— 一次性弹 N 条
  // 会让提示条互相顶掉；更早的轮次仍可在下次休眠后按同一路径出现。
  useEffect(() => {
    void readAutoDiscardBatches()
      .then((batches) => {
        const latest = [...batches].sort((a, b) => b.at - a.at)[0];
        if (latest && latest.tabIds.length > 0) showDiscardUndoToast(latest);
      })
      .catch((error: unknown) => {
        // 读取失败必须留痕：否则「没有可唤醒的批次」与「台账一直在读失败」无从分辨。
        logFailure('sidepanel', '自动休眠台账读取失败', error);
      });
  }, [showDiscardUndoToast]);

  // 复用引擎（同网址唯一化）关闭的标签 → 登记进撤销栈。
  // 该能力默认开启，关闭发生在 SW 内（面板拿不到标签快照），不回传就形成一条
  // 「经Tabs执行却不可撤销」的关闭路径。消息经既有 runtime 协议，不自造通道。
  useEffect(
    () =>
      onRuntimeMessage((message) => {
        if (message.type !== 'reuse-closed') return;
        void useUndoStore.getState().recordReuseClosed(message.windowId, message.tabs);
      }),
    []
  );

  // 首启引导延迟弹出：数据就绪后先让用户看到真实列表 TOUR_AUTO_OPEN_DELAY_MS，
  // 避免模态遮罩第一时间盖住被介绍的对象。引导完成（onboarded）后不再触发。
  // 延迟窗口内用户一旦开始操作（指针/键盘）即放弃本次自动弹出 ——
  // 用户已经上手了，再弹模态介绍只会打断他（可从设置页「重新观看引导」找回）。
  useEffect(() => {
    if (!dataReady || settings.onboarded) return;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      window.clearTimeout(timer);
      detach();
    };
    const detach = () => {
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('keydown', cancel, true);
    };
    const timer = window.setTimeout(() => {
      detach();
      if (!cancelled) setShowTour(true);
    }, TOUR_AUTO_OPEN_DELAY_MS);
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('keydown', cancel, true);
    return () => {
      window.clearTimeout(timer);
      detach();
    };
  }, [dataReady, settings.onboarded]);

  // 面板未开时挂起的动作由 usePendingActions 内部订阅（初始 get + session.onChanged）。

  // 固定空间排除集：挂起条目标签 + 绑定标签
  const fixedExcludedTabIds = useMemo(() => {
    const excluded = new Set<number>(boundTabIds);
    for (const folder of folders) {
      for (const item of folder.items) {
        if (item.pendingTabId !== undefined) excluded.add(item.pendingTabId);
      }
    }
    return excluded;
  }, [boundTabIds, folders]);

  // 分区派生与折叠态展示（含复用基线的性能约定，见该 hook 注释）。
  const {
    pinnedSection,
    restSections,
    pinnedSortableIds,
    displayCollapsedGroups,
    displayCollapsedSites,
    collapsibleSections,
    allSectionsCollapsed,
    handleToggleAllSections
  } = useSectionDerivation({
    tabs,
    groups,
    filteredTabs,
    isFiltering,
    excludedTabIds: fixedExcludedTabIds,
    sortMode: settings.sortMode,
    groupMode: settings.groupMode,
    aggregationThreshold: settings.aggregationThreshold,
    t,
    collapsedSites,
    setGroupCollapsed,
    toggleSiteCollapsed
  });

  /**
   * 键盘漫游序列（空查询态）：按列表显示顺序展开可见分区 ——
   * 常驻磁贴区在前，其后是各未折叠分区。折叠分区内的标签**不进序列**：
   * 它们在 DOM 里不存在，选中一个看不见的标签会让 Enter 变成「激活未知项」。
   */
  const roamTabIds = useMemo(
    () =>
      buildRoamOrder({
        showPinnedStrip: settings.showPinnedStrip,
        pinnedSection,
        restSections,
        collapsedGroups: displayCollapsedGroups,
        collapsedSites: displayCollapsedSites
      }),
    [
      settings.showPinnedStrip,
      pinnedSection,
      restSections,
      displayCollapsedGroups,
      displayCollapsedSites
    ]
  );

  /**
   * 键盘漫游：搜索态走命中序列（相关度），空态走可见列表顺序。
   * `resetKey` 用 query —— 输入变化时回到首项（与搜索预期一致）。
   */
  const { selectedTabId: selectedNavTabId, handleKeyDown: handleNavKeyDown } = useListNavigation({
    tabIds: isFiltering ? searchHitTabIds : roamTabIds,
    resetKey: query,
    onActivate: smartActivate
  });

  /** 搜索框按键：漫游（↑↓ / Enter）优先；未消费的交给搜索自身（Esc 清空并失焦）。 */
  const handleSearchInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (handleNavKeyDown(event)) return;
      handleSearchKeyDown(event);
    },
    [handleNavKeyDown, handleSearchKeyDown]
  );

  // 原生分组的写入（建组 / 吸收 / 移出漂移成员 / 开关解散）全部由 background 的
  // autoGroup 引擎负责：那是「浏览器状态 → 浏览器状态」的同步，不该依赖面板是否挂载，
  // 也不该等「快照 → 重渲染 → 再派生」这一圈。面板只负责派生分区用于渲染。

  // 拖拽分发（排序/投放/建文件夹/固定）独立为 hook，handler 引用稳定。
  const { onDragEnd, handleReorder, handleMoveTab } = useTabDragHandlers();
  const duplicateIndex = useMemo(() => DuplicateIndex.build(tabs), [tabs]);
  const duplicateCounts = useMemo(() => duplicateIndex.counts(), [duplicateIndex]);
  // 可清理的重复标签数（与清理动作共用 planDuplicateCleanup，口径必然一致）。
  // >0 时底栏出现「清理重复」入口（与「唤醒全部」同款条件出现模式）。
  const duplicateRemovableCount = useMemo(
    () => planDuplicateCleanup(duplicateIndex, boundTabIds).removable.length,
    [duplicateIndex, boundTabIds]
  );

  const partners = useMemo(() => splitPartnerIds(tabs, activeTabId), [tabs, activeTabId]);

  /**
   * 习惯洞察条数。
   *
   * 与 SnapshotsPanel 内 computeInsights 同源同参：徽章显示的数量必须等于打开后
   * 看到的条目数，否则「点进去发现是空的」—— 和「清理重复」徽章与执行共用
   * planDuplicateCleanup 是同一条不变量。
   */
  const insights = useMemo(() => computeInsights(tabs, new Set(boundTabIds)), [tabs, boundTabIds]);
  const insightCount =
    insights.duplicateHotspots.length +
    (insights.discardableCount > 0 ? 1 : 0) +
    insights.staleTabs.length;

  // 与浏览器多选高亮同步（tabs.onHighlighted）。
  useEffect(() => onTabHighlighted(setHighlighted), [setHighlighted]);

  // 按语言分组时，异步探测未分组标签的语言。
  // 批量探测 + 一次 set：逐条 setLanguage 会让 N 个标签产生 N 轮全量派生 + 整树重渲染；
  // in-flight 登记防「探测未回期间来了新快照」对同一标签重复发起探测。
  const langInFlightRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (settings.groupMode !== 'language') return;
    const eligible = tabs.filter(
      (tab) =>
        !tab.pinned &&
        tab.groupId === NO_GROUP &&
        !tab.language &&
        !langInFlightRef.current.has(tab.id)
    );
    if (eligible.length === 0) return;
    let cancelled = false;
    for (const tab of eligible) langInFlightRef.current.add(tab.id);
    void Promise.all(eligible.map((tab) => detectLanguage(tab.id)))
      .then((langs) => {
        for (const tab of eligible) langInFlightRef.current.delete(tab.id);
        if (cancelled) return;
        useTabStore
          .getState()
          .setLanguages(eligible.map((tab, index) => [tab.id, langs[index] ?? 'und']));
      })
      .catch((error: unknown) => {
        // detectLanguage 内部有 'und' 兜底，此处兜住意外 rejection（polyfill
        // 边界/API 异常路径）：必须清理 in-flight 登记，否则这些标签永远
        // 失去再探测机会，且产生 unhandled rejection。
        // 语言探测失败本身不提示（按语言分区只是增强），但必须留痕 ——
        // 否则「语言分区一直不出现」无法归因。
        logDegraded('sidepanel', '标签语言探测失败', error);
        for (const tab of eligible) langInFlightRef.current.delete(tab.id);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.groupMode, tabs]);

  /** 手动重试数据初始化（自动重试失败后错误态的出口）。 */
  const handleRetryLoad = useCallback(() => {
    setLoadFailed(false);
    void initializeData().catch((error: unknown) => {
      logDegraded('sidepanel', '手动重试数据初始化仍失败', error);
      setLoadFailed(true);
    });
  }, [initializeData]);

  /**
   * 关闭浏览器多选（Ctrl+Click）的标签。
   *
   * 多选高亮若只有视觉、没有操作出口，用户选中几个标签后会尝试「一起关掉」而失败；
   * 这里补上出口（走既有撤销管线，可反悔）。
   */
  const handleCloseHighlighted = useCallback(() => {
    const state = useTabStore.getState();
    const ids = [...state.highlightedIds];
    if (ids.length === 0) return;
    void closeWithUndo(state.tabs, ids);
  }, [closeWithUndo]);

  const handleCloseTab = useCallback(
    (tab: TabRecord) => {
      void closeWithUndo(useTabStore.getState().tabs, [tab.id]);
    },
    [closeWithUndo]
  );

  /**
   * 一键清理重复标签：每个网址保留「最近访问 > 激活 > 固定 > 位置靠前 > id 大」的一个
   * （固定标签豁免），
   * 关闭其余可清理者。走既有 closeWithUndo 管线 —— 清理同样进撤销栈、可一键反悔。
   * 固定空间绑定的标签额外豁免：那是用户显式保存的资产，不能被自动清理。
   *
   * 清理后对「保留项」播放一次脉冲高亮：结果不再只是一个数量，
   * 用户能看到每个域名留下了哪一个（否则只能靠撤销后反推）。
   *
   * 批量动作用「**影响面提示**」而非「强制确认弹窗」——
   * 点击即执行，不给高频用户加摩擦。影响面由两处承载：
   *   ① 执行前：底栏入口徽章/`title` 上的待清理数量（见 sleepableCount 同款口径）；
   *   ② 执行后：`closeWithUndo` 的回执（已关闭数）与保留项脉冲。
   * 清理本身进撤销栈、可一键反悔，因此不需要阻断式确认。
   */
  /**
   * 固定/取消固定带 toast 反馈。
   *
   * 必须给出反馈：标签移动到固定区后，若 `showPinnedStrip` 关闭、或固定区折叠/
   * 滚出视野，用户在扩展内看不到任何变化（只能从浏览器原生标签栏察觉），会怀疑没生效。
   */
  const handleTogglePin = useCallback(
    (tab: TabRecord) => {
      void togglePinned(tab).then((ok) => {
        // 平台层真实结果驱动反馈：失败（标签已关闭/不可固定）时不提示「已固定」。
        if (!ok) {
          notifyError(t('操作失败，请稍后重试'));
          return;
        }
        notify(t(tab.pinned ? '已取消固定' : '已固定标签'));
        // 固定↔取消固定会改变标签在分组的归属（置顶区 ↔ 站点分组/未分组）：
        // 主动刷新快照，让标签立即按新 pinned 状态归类，不依赖事件回灌时序。
        tabSyncService.requestRefresh();
      });
    },
    [togglePinned, notify, notifyError, t]
  );
  const handleDuplicateTab = useCallback(
    (tab: TabRecord) => {
      void duplicateTab(tab.id).then((ok) => notify(t(ok ? '已复制标签' : '操作失败，请稍后重试')));
    },
    [duplicateTab, notify, t]
  );
  const handleDiscardTab = useCallback(
    (tab: TabRecord) => {
      if (!canSafelyDiscardTab(tab) || useDataStore.getState().boundTabIds.includes(tab.id)) {
        notify(t('这个标签正在使用（播放声音或尚未加载完），已跳过'));
        return;
      }
      void discardTab(tab.id).then((discarded) =>
        discarded ? notify(t('已休眠标签')) : notifyError(t('休眠失败，请稍后重试'))
      );
    },
    [discardTab, notify, notifyError, t]
  );
  /**
   * 归档当前窗口：先给影响面确认（将关闭 N 个标签），确认后才真正执行。
   *
   * 归档虽可撤销，但栈深有限、后续关闭会把它挤掉 —— 误触即丢，必须拦一道。
   * （恢复是新建整批标签，同样强制确认。）
   */
  const requestArchive = useCallback(() => {
    const closable = selectArchivableTabs(useTabStore.getState().tabs);
    if (closable.length === 0) {
      // 入口常驻（命令面板 / 洞察出口）：无可归档标签时点按不能静默。
      notify(t('当前窗口没有可归档的标签'));
      return;
    }
    setPendingArchiveCount(closable.length);
  }, [notify, t]);

  const performArchive = useCallback(() => {
    setPendingArchiveCount(null);
    void useSnapshotStore
      .getState()
      .archiveCurrentWindow()
      .then((count) => notify(t('已归档 {{count}} 个标签', { count })))
      .catch((error: unknown) =>
        useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
      );
  }, [notify, t]);

  /**
   * 导出备份并下载（首启引导终步与「数据只在本机、卸载即清除」的提醒配套）。
   * 与设置页共用 platform 的下载实现，结果同样走 toast：导出失败必须可见
   * （宁可明确报错，也不能让用户以为已经备份了）。
   */
  const handleExportBackup = useCallback(() => {
    void useDataStore
      .getState()
      .exportData()
      .then((payload) => {
        downloadJsonFile(datedJsonFilename('tabs-backup'), JSON.stringify(payload, null, 2));
        notify(t('备份已导出'));
      })
      .catch((error: unknown) =>
        useUndoStore.getState().notifyFailure('sidepanel', t('导出失败：本地数据读取未完成'), error)
      );
  }, [notify, t]);

  const discardedCount = tabs.filter((tab) => tab.discarded).length;
  // 休眠入口的影响面提示（与执行口径同源 selectSleepableTabs）：
  // 让用户在按下前就知道会休眠多少个，而不是执行后才知道。
  const sleepableCount = useMemo(
    () => selectSleepableTabs(tabs, boundTabIds).length,
    [tabs, boundTabIds]
  );
  // 原生标签组 → 固定文件夹（桥接反向）。
  const handleSaveGroupAsFolder = useCallback(
    (groupId: number) => {
      // 落盘名走常量而非 `t()`：按界面语言生成会让中英文界面产出两套名字，
      // 与导入侧「同名合并」的语义打架（见 core/snapshot/defaultNames）。
      const name =
        useTabStore.getState().groups.find((g) => g.id === groupId)?.title ||
        DEFAULT_FOLDER_NAMES.unnamedGroup;
      const groupTabs = useTabStore.getState().tabs.filter((tab) => tab.groupId === groupId);
      void createFolderFromNativeGroup(name, groupTabs).then((saved) =>
        // 组内无可收藏标签时不建空夹（返回 false），用区分文案而非“已保存”。
        notify(t(saved ? '已存为文件夹' : '该分组里没有可保存的标签'))
      );
    },
    [createFolderFromNativeGroup, notify, t]
  );

  const handleRenameGroup = useCallback(
    (groupId: number, title: string) => void renameGroup(groupId, title),
    [renameGroup]
  );
  const handleRecolorGroup = useCallback(
    (groupId: number, color: string) => void recolorGroup(groupId, color),
    [recolorGroup]
  );

  // 快速整理：完全重新初始化临时区分组 —— 打散现有临时区原生组（分组+未分组），
  // 按当前聚合方式重组全部非固定标签；固定区域（浏览器置顶 / 顶部常驻磁贴 / 固定空间）不受影响。
  const handleQuickRegroup = useCallback(() => {
    if (quickRegrouping) return;
    const plan = planRegroup({
      tabs,
      excludedTabIds: fixedExcludedTabIds,
      groupMode: settings.groupMode,
      threshold: settings.aggregationThreshold
    });
    if (plan.ungroupTabIds.length === 0 && plan.plans.length === 0) {
      notify(t('没有需要重新分组的标签'));
      return;
    }
    // 点击即执行，不弹确认。
    // 快速整理打散并重建浏览器原生组、不进撤销栈，是Tabs唯一不可反悔的破坏性动作，
    // 与「一切关闭都可反悔」的核心承诺冲突。因此执行前先存一份现场快照当回退点：
    // 存不进去就中止重排，绝不裸奔执行（与归档同款纪律：保存失败不关标签）。
    setQuickRegrouping(true);
    void (async () => {
      let snapshotSaved: boolean;
      try {
        // 名字是落盘数据（会进导出备份），必须用常量而不是 t()：否则英文界面
        // 保存的是译文、中文界面是中文，同一批数据出现两种名字。
        snapshotSaved = await useSnapshotStore
          .getState()
          .saveCurrentWindow(DEFAULT_SNAPSHOT_NAMES.regroup);
      } catch (error) {
        logFailure('sidepanel', '重排前保存现场快照失败，已取消重排', error);
        notifyError(t('无法保存重排前的现场快照，已取消重排（标签与分组未改动）'));
        return;
      }
      // saveCurrentWindow 返回 false = 现场无可保存标签（如只剩 chrome:// 内部页），
      // 此时 store 已给出可见回执，且**没有**任何回退快照。必须中止重排：
      // 快速整理是不可撤销的破坏性动作，注释承诺「存不进去就中止，绝不裸奔执行」，
      // 忽略这个布尔返回值会让空现场下的分组被打散重建且无从恢复。
      if (!snapshotSaved) return;
      const count = await regroupTempArea(plan.ungroupTabIds, plan.plans);
      // 快速整理直接打散并重建浏览器原生组：显式请求快照刷新，让整理结果
      // 立即呈现（与事件驱动刷新共用 signal 合并，不会重复查询）。
      tabSyncService.requestRefresh();
      notify(t('已重新分组 {{count}} 个组 · 重排前现场已存入快照，可回退', { count }));
    })()
      .catch((error: unknown) =>
        useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
      )
      .finally(() => setQuickRegrouping(false));
  }, [
    quickRegrouping,
    tabs,
    fixedExcludedTabIds,
    settings.groupMode,
    settings.aggregationThreshold,
    notify,
    notifyError,
    t
  ]);

  /**
   * 关闭整个分区（同一域名的标签一次全关）。
   *
   * 走统一撤销批次 closeWithUndo：整批一次入栈，撤销一次即可全部找回
   * （逐个关闭会产生 N 条批次、N 次提示，撤回要点 N 次）。
   * 分区内的 pinned / 隐身标签由分区构造阶段排除（见 core/site/Sections），
   * 这里不再重复过滤，避免两处口径漂移。
   */
  const handleCloseSection = useCallback((section: TemporarySection) => {
    const closable = section.tabs;
    if (closable.length === 0) return;
    void useUndoStore.getState().closeWithUndo(
      closable,
      closable.map((tab) => tab.id)
    );
  }, []);

  // SectionList 为 memo 组件：callbacks 必须保持引用稳定（仅语言与 store 函数变化时重建），
  // 否则每次渲染都会导致整个列表树重渲染。所有 handler 均从 store getState 读取最新数据。
  const sectionCallbacks = useMemo(
    () => ({
      onActivate: (tabId: number) => void smartActivate(tabId),
      // 静音必须有明确反馈：它的视觉信号只是按钮图标变化，而操作按钮默认
      // hover 才出现（rowActionsVisible 默认关），用户常常根本没看到那个图标。
      onToggleMute: (tab: TabRecord) => {
        void Promise.resolve(toggleMute(tab)).then(() =>
          notify(tab.muted ? t('已取消静音') : t('已静音'))
        );
      },
      onTogglePin: handleTogglePin,
      onCloseTab: handleCloseTab,
      onDuplicate: handleDuplicateTab,
      onDiscard: handleDiscardTab,
      onSaveGroupAsFolder: handleSaveGroupAsFolder,
      onGroupRename: handleRenameGroup,
      onGroupRecolor: handleRecolorGroup,
      onToggleGroupCollapsed: (groupId: number, collapsed: boolean) =>
        void setGroupCollapsed(groupId, collapsed),
      onToggleSiteCollapsed: (siteKey: string, collapsed: boolean) => {
        void toggleSiteCollapsed(siteKey, collapsed);
      },
      onReorder: handleReorder,
      onMoveTab: handleMoveTab,
      onCloseSection: handleCloseSection
    }),
    [
      smartActivate,
      handleCloseSection,
      toggleMute,
      handleTogglePin,
      setGroupCollapsed,
      toggleSiteCollapsed,
      handleCloseTab,
      handleDuplicateTab,
      handleDiscardTab,
      handleSaveGroupAsFolder,
      handleRenameGroup,
      handleRecolorGroup,
      handleReorder,
      handleMoveTab,
      notify,
      t
    ]
  );

  /**
   * 打开文件夹全部条目（「文件夹即空间」的命令面板出口）：
   * 只开缺失条目（窗口内已打开的跳过），与 FolderRow.handleOpenAll 同口径；
   * 导入事务进行中固定空间只读不影响「打开」（不写 folders），无需禁用。
   */
  const handleOpenFolder = useCallback(
    (folderId: string) => {
      const folder = useDataStore.getState().folders.find((entry) => entry.id === folderId);
      if (!folder) return;
      const liveTabs = useTabStore.getState().tabs;
      const missing = folder.items.filter(
        (item) =>
          item.url &&
          item.pendingTabId === undefined &&
          !liveTabs.some((tab) => itemUrlMatchesTab(item.url, tab) && !tab.incognito)
      );
      if (missing.length === 0) {
        notify(t('文件夹条目均已打开'));
        return;
      }
      void createTabsWithUrls(
        missing.map((item) => item.url).filter((u): u is string => Boolean(u))
      )
        .then((created) => notify(t('已打开 {{count}} 个条目', { count: created })))
        .catch((error: unknown) =>
          useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
        );
    },
    [notify, t]
  );

  // 其他窗口分段（A4）：独立数据源，不进 tabStore（契约见 hook 注释）。
  // 开关关闭或搜索态时不查询、不订阅（搜索态由历史命中区接管回溯语义）。
  const {
    otherWindows,
    status: otherWindowsStatus,
    retry: retryOtherWindows
  } = useOtherWindows(settings.showOtherWindows && !isFiltering);

  // 命令面板动作集合（⌘P）：复用既有 handler。必须 memo 化：面板打开期间每次
  // 标签快照都重建 actions 引用，会让 CommandPalette 的 commands 重算、索引钳制与
  // scrollIntoView effect 反复执行。
  const paletteActions: PaletteActions = useMemo(
    () => ({
      onDiscardInactive: discardInactive,
      onWakeAll: wakeAll,
      onQuickRegroup: handleQuickRegroup,
      onCleanDuplicates: closeDuplicates,
      onLocateActive: locateActiveViaRef,
      onOpenHistory: openHistory,
      onOpenSettings: openOptionsPage,
      onExportData: handleExportBackup,
      // 命令面板一次直达关于页，省掉「底栏设置 → 设置页 → 关于页」的三步路径。
      onOpenAbout: openAboutPage,
      onToggleAllSections: handleToggleAllSections,
      onSwitchTab: (tabId: number) => void smartActivate(tabId),
      onOpenSnapshots: () => openSnapshots('list'),
      onSaveSnapshot: () =>
        void useSnapshotStore
          .getState()
          .saveCurrentWindow()
          // false = 现场无可保存标签：store 已给出可见回执，不能再补一条「已保存快照」
          // 的假成功提示（两条矛盾的提示同时出现，用户无从判断到底存没存）。
          .then((saved) => {
            if (saved) notify(t('已保存快照'));
          })
          .catch((error: unknown) =>
            useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
          ),
      onSaveSpace: () =>
        // 与 useSpaces / SnapshotsPanel 同口径：不传名字，命名交给 store 的
        // fallbackName，避免把界面语言写进落盘快照名。
        void useSnapshotStore
          .getState()
          .saveSpace()
          // 与 useSpaces 同口径：动作是「保存为工作区」，反馈不能说「已保存快照」。
          // 同样只有 saved=true 才提示：false 时 store 已回执「没有可保存的当前标签」。
          .then((saved) => {
            if (saved) notify(t('已保存工作区'));
          })
          .catch((error: unknown) =>
            useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
          ),
      onArchiveWindow: requestArchive,
      onOpenFolder: handleOpenFolder,
      // 「把当前标签存到文件夹」：面板内唯一的非拖拽归档入口。
      // 没有激活标签时（如面板刚打开、标签正在加载）不静默失败，必须说明。
      onSaveTabToFolder: (folderId) => {
        const target = useTabStore.getState().tabs.find((tab) => tab.id === activeTabId);
        if (!target) {
          notifyError(t('没有可保存的当前标签'));
          return;
        }
        void useDataStore
          .getState()
          .addTabsToFolder([target], folderId)
          .then((result) => {
            if (result.added > 0 || result.moved > 0) {
              notify(t('已存到文件夹'));
            } else {
              notify(t('该标签已在这个文件夹里'));
            }
          })
          .catch((error: unknown) =>
            useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
          );
      },
      onSwitchSpace: (spaceId) => {
        const space = useSnapshotStore
          .getState()
          .snapshots.find((snapshot) => snapshot.id === spaceId && snapshot.origin === 'space');
        if (space) switchSpace(space);
      }
    }),
    [
      discardInactive,
      wakeAll,
      handleQuickRegroup,
      closeDuplicates,
      locateActiveViaRef,
      handleExportBackup,
      handleToggleAllSections,
      handleOpenFolder,
      requestArchive,
      smartActivate,
      activeTabId,
      switchSpace,
      openHistory,
      openSnapshots,
      notify,
      notifyError,
      t
    ]
  );

  /** 历史命中「打开该页面」：仅新建一个标签（最轻量找回），失败走错误提示。 */
  const handleHistoryOpenUrl = useCallback(
    (url: string) => {
      void createTabsWithUrls([url])
        .then(() => notify(t('已打开该页面')))
        .catch((error: unknown) =>
          useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
        );
    },
    [notify, t]
  );

  /** 历史命中「恢复该快照」：恢复不在撤销栈覆盖范围，同样先弹影响面确认。 */
  const handleHistoryRestoreSnapshot = useCallback(
    (snapshotId: string, tabCount: number) => {
      if (tabCount === 0) {
        notify(t('该快照没有可恢复的标签'));
        return;
      }
      const snapshot = useSnapshotStore
        .getState()
        .snapshots.find((entry) => entry.id === snapshotId);
      // 快照已不在列表（被删除）时无从给出影响面，直接按原路径恢复。
      if (!snapshot) {
        void useSnapshotStore
          .getState()
          .restore(snapshotId)
          .then(({ count, degraded }) =>
            notify(
              degraded
                ? t('已恢复 {{count}} 个标签；未能读取窗口现状，可能多开了已经打开着的页面', {
                    count
                  })
                : t('已恢复 {{count}} 个标签', { count })
            )
          )
          .catch((error: unknown) =>
            useUndoStore.getState().notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
          );
        return;
      }
      setPendingHistoryRestore(snapshot);
    },
    [notify, t]
  );

  return (
    /* data-density 提到 .app：密度要覆盖固定空间与主列表两条渲染链。
       只挂在 SectionList 上时，固定空间的条目行不经 RowItem 的 density prop，
       切换档位纹丝不动。 */
    <main className="app flex h-full flex-col" data-density={settings.density}>
      {/* 视觉上隐藏：面板顶部已有搜索框与品牌标识，再加一个可见标题是噪音；
          但标题必须存在，否则读屏用户无法用「跳到标题」定位，也拿不到页面主题。 */}
      <h1 className="sr-only">{t('当前窗口的标签')}</h1>
      <DndRoot onDragEnd={onDragEnd}>
        <SettingsSync />
        <SearchBar
          query={query}
          onChange={setQuery}
          inputRef={searchInputRef}
          onKeyDown={handleSearchInputKeyDown}
          /* 有可选项才允许提示（聚焦时显示）：空态同样支持漫游，故不再要求先输入 */
          showKeyboardHint={isFiltering ? filteredTabs.length > 0 : tabs.length > 0}
          showHistoryToggle
          historyOn={settings.searchHistory}
          onToggleHistory={() => void tryUpdateSettings({ searchHistory: !settings.searchHistory })}
        />
        {/* 搜索命中数对读屏播报（<output> 原生隐含 role=status）：视觉用户有列表过滤反馈，读屏用户没有 */}
        <output className="sr-only" aria-live="polite">
          {isFiltering ? t('命中 {{count}} 个标签', { count: filteredTabs.length }) : ''}
        </output>
        {/* 落盘失败横幅：由「最近一次持久化是否成功」驱动（成功写会复位标志），
            因此它表达的是「此刻存储可能不可写」，而非「历史上有过失败」。
            宁可多提示一次，也不能让「界面显示成功、重启即丢」静默发生。 */}
        {storageDegraded && (
          <Callout
            role="alert"
            tone="warn"
            /* 去掉 mx-1：mx-1 + px 内距 = 16px，与全局 8px 内容竖线错开，
               一屏出现两道左边缘（横幅 16 / 列表 8）。 */
            className="mb-1"
            icon={Icons.infoAlert}
          >
            <p className="text-3xs leading-relaxed">
              {t(
                '最近的改动可能没能保存到本地：请检查浏览器存储空间是否已满，或扩展权限是否被收回'
              )}
            </p>
          </Callout>
        )}
        {/* 一次性「能力发现」Tip：仅首次展示。刻意排在搜索框之后——搜索是本面板最高频入口，
            教学性内容不得把它挤出首屏顶部。 */}
        {!settings.tipSeen && (
          <Callout
            className="mb-1"
            icon={Icons.sparkles}
            action={
              <Button
                variant="accent-ghost"
                size="dense"
                className="shrink-0"
                onClick={() => void tryUpdateSettings({ tipSeen: true })}
              >
                {t('知道了')}
              </Button>
            }
          >
            <p className="text-3xs font-semibold">{t('三处入口用满 Tabs 的能力')}</p>
            <p className="mt-0.5 text-3xs leading-relaxed text-accent-700/90">
              {t(
                '① 页面 / 链接 / 标签栏右键可休眠、固定、按域名搜索；② 地址栏输入 t 后输关键词直达；③ ⌘P（Ctrl+P）打开命令面板，一步执行休眠 / 存快照 / 开设置。'
              )}
            </p>
          </Callout>
        )}
        {/* 工作区切换条（C1）：无工作区快照时整条隐藏。 */}
        <SpaceStrip
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          switching={switching}
          onSwitch={switchSpace}
          onExit={exitSpace}
          onSaveAs={saveAsSpace}
        />
        {settings.showPinnedStrip && <PinnedStrip />}
        {/* 浏览器原生固定标签区 — 同样受 showPinnedStrip 控制，与顶部固定空间条联动隐藏，避免
          用户关闭开关后磁贴区仍残留造成"开关没作用"的困惑。pinnedSection 本身为空（用户没原生
          固定标签）时仍按需不渲染。 */}
        {settings.showPinnedStrip && pinnedSection && (
          <CategoryModule
            title={pinnedSection.title}
            count={pinnedSection.tabs.length}
            className="shrink-0 is-pinned"
          >
            <SortableContext items={pinnedSortableIds} strategy={rectSortingStrategy}>
              <div ref={nativePinGridRef} className="pinned-grid scroll-fade">
                {pinnedSection.tabs.map((tab) => (
                  <SortablePinnedTile
                    key={tab.id}
                    id={tab.id}
                    tabId={tab.id}
                    title={tab.title || ''}
                    favIconUrl={tab.favIconUrl}
                    url={tab.url}
                    isActive={tab.active}
                    isDiscarded={tab.discarded}
                    isAudible={tab.audible}
                    onOpen={() => activateTab(tab.id)}
                    onMiddleClick={() => handleCloseTab(tab)}
                    // 与行内取消固定同一入口：裸 togglePinned 无任何反馈，当
                    // showPinnedStrip 关闭或置顶区滚出视野时用户无从确认生效。
                    onUnpin={() => handleTogglePin(tab)}
                    unpinTitle={t('取消固定')}
                  />
                ))}
              </div>
            </SortableContext>
          </CategoryModule>
        )}
        {/* 不加横向 padding：内容竖线由 .section-head / .section-body 统一给出 8px，
            这里再加会把固定空间与主列表整体右移，与顶栏搜索图标、Toast、新建栏不同线。 */}
        <div className="py-0.5">
          <FixedArea />
        </div>
        <div
          /* overscroll-contain：这是「固定空间 → 主列表 → 虚拟列表」三层滚动链的中间层，
             内外两层都有隔离，唯独中间层没有 —— 内层滚到边界会带着主列表一起滚。 */
          /* min-h：flex:1 1 0% 遇到 overflow-y-auto 时 min-height:auto 解析为 0，
             同级 flex:none 块合计过高会把主列表压成 0 高（用户看到"列表消失了"）。
             给 120px 保底；真装不下时由 .app 的 overflow-y:auto 兜住（可滚到底栏），
             绝不能用 hidden —— 那会让底栏与「新建标签」被裁掉且再也滚不到。 */
          ref={listScrollRef}
          className="min-h-[120px] flex-1 overflow-y-auto overscroll-contain py-0.5"
          /* 列表级键盘漫游：一个 Tab 进入列表后，用 ↑↓ / Home / End 在行之间移动焦点。
             否则 100 个标签就是上百个 Tab 停靠点（每行还有若干操作按钮），
             仅键盘与读屏用户几乎无法在列表里穿行。 */
          onKeyDown={handleListKeyDown}
          onWheel={markUserScroll}
          onTouchMove={markUserScroll}
        >
          {/* tabSyncReady 必须与 dataReady 一起守卫：标签首帧同步未回时 tabs 恒为 []，
              只判 dataReady 会先闪一屏「这个窗口还没有标签 + 打开新标签」再跳成列表。 */}
          {!dataReady || !tabSyncReady ? (
            loadFailed ? (
              /* 自动重试仍失败：给出说明与手动出口，不留无出口的骨架屏 */
              <LoadErrorState onRetry={handleRetryLoad} />
            ) : (
              // 加载骨架：区分「同步中」与「真的没有标签」
              // 传 density：骨架复用真实行的盒模型，档位不同则加载完成时行高会跳
              <LoadingSkeleton density={settings.density} />
            )
          ) : tabs.length === 0 ? (
            <EmptyTabs
              // 空窗口 + 有快照：崩溃/误关是「窗口突然空了」的高频成因，
              // 此时「从快照恢复」比「新建标签」更贴合意图（与 UndoHistoryPanel 同一引导语义）。
              hasSnapshots={snapshotCount > 0}
              onOpenSnapshots={() => {
                openSnapshots('list');
              }}
            />
          ) : isFiltering && filteredTabs.length === 0 ? (
            <NoSearchResults
              onClear={() => setQuery('')}
              // 开开关后保留当前 query：用户要的是「换个范围再搜一次」，
              // 不是「清空重来」。
              onSearchAllWindows={
                settings.searchAllWindows
                  ? undefined
                  : () => void useDataStore.getState().tryUpdateSettings({ searchAllWindows: true })
              }
            />
          ) : (
            <>
              <SectionList
                sections={restSections}
                collapsedGroups={displayCollapsedGroups}
                collapsedSites={displayCollapsedSites}
                duplicateCounts={duplicateCounts}
                activeTabId={activeTabId}
                splitPartners={partners}
                reorderEnabled={settings.tabOrderSync}
                showUrl={settings.showUrl}
                autoScrollActive={settings.autoScrollActive && !userScrollActive}
                closeOnMiddleClick={settings.closeOnMiddleClick}
                density={settings.density}
                rowActionsVisible={settings.rowActionsVisible}
                showSplitBadges={settings.showSplitBadges}
                highlightedIds={highlightedIds}
                searchActiveTabId={selectedNavTabId}
                noCacheTabIds={noCacheTabIds}
                groupMode={settings.groupMode}
                callbacks={sectionCallbacks}
              />
            </>
          )}
          {/* A4 其他窗口分段：非搜索态展示（搜索态由历史命中区接管回溯语义），
              主体列表之下、新增标签条之上。 */}
          {!isFiltering && settings.showOtherWindows && (
            <OtherWindowsSection
              otherWindows={otherWindows}
              status={otherWindowsStatus}
              onRetry={retryOtherWindows}
              onFocusTab={handleOtherWindowFocus}
              onCloseTab={handleOtherWindowClose}
              onPullToWindow={handlePullToWindow}
            />
          )}
        </div>

        {/* 历史命中分区：仅过滤态且设置开启时展示；当前标签在上方列表，
            历史是回溯补充，刻意放列表之后。 */}
        {isFiltering && settings.searchHistory && historyHits.length > 0 && (
          <HistoryHitsSection
            hits={historyHits}
            onOpenUrl={handleHistoryOpenUrl}
            onRestoreSnapshot={handleHistoryRestoreSnapshot}
          />
        )}

        <div className="add-tab-bar">
          {/* aria-label 不能省：≤300px 档的 CSS 会把 <span> 文字 display:none，
              display:none 同时把文本移出可访问树 —— 窄面板下这个按钮会变成
              一个没有名称的空「按钮」，而它是侧栏最核心的入口。 */}
          {/* 虚线框整条「新建标签」：盒模型与配色由 .add-tab-btn（unlayered）承担，
              Button 只补 label / disabled / 焦点环口径。 */}
          <Button
            variant="ghost"
            size="sm"
            className="add-tab-btn"
            label={t('新建标签')}
            onClick={() => void createNewTab()}
          >
            <Icon d={Icons.plus} className="h-4 w-4" />
            <span>{t('新建标签')}</span>
          </Button>
        </div>

        {/* 提示条挂在「+ 新建标签」与底栏之间（实体占位）：浮层会盖住用户正在操作的行。 */}
        <StatusToast />

        <FooterToolbar
          tabCount={tabs.length}
          footerLabels={settings.footerLabels}
          collapsibleCount={collapsibleSections.length}
          allCollapsed={allSectionsCollapsed}
          activeTabId={activeTabId}
          discardedCount={discardedCount}
          sleepableCount={sleepableCount}
          duplicateCount={duplicateRemovableCount}
          insightCount={insightCount}
          onOpenInsights={() => {
            openSnapshots('report');
          }}
          highlightedCount={highlightedIds.size}
          quickRegrouping={quickRegrouping}
          onToggleAllSections={handleToggleAllSections}
          // 在途态下传：对应入口在批量操作期间禁用，避免「点了没反应」
          batchBusy={batchBusy}
          onDiscardInactive={discardInactive}
          onWakeAll={wakeAll}
          onQuickRegroup={handleQuickRegroup}
          onCleanDuplicates={closeDuplicates}
          onCloseHighlighted={handleCloseHighlighted}
          onLocateActive={locateActiveViaRef}
          onOpenHistory={openHistory}
          onOpenSettings={openOptionsPage}
          footerOrder={settings.footerOrder}
          onReorderFooter={handleReorderFooter}
          // 信任面板：底栏一次直达，与设置页「关于」同一入口。
          onOpenAbout={openAboutPage}
          onOpenSnapshots={() => {
            openSnapshots('list');
          }}
          undoBatchCount={undoBatchCount}
          snapshotCount={snapshotCount}
          onOpenPalette={openPalette}
        />
        {showHistory && (
          <UndoHistoryPanel
            hasSnapshots={snapshotCount > 0}
            onOpenSnapshots={() => {
              openSnapshots('list');
            }}
            onClose={closeLayer}
          />
        )}
        {pendingHistoryRestore !== null && (
          <RestoreConfirmDialog
            snapshot={pendingHistoryRestore}
            onConfirm={() => {
              const snapshot = pendingHistoryRestore;
              setPendingHistoryRestore(null);
              void useSnapshotStore
                .getState()
                .restore(snapshot.id)
                .then(({ count, degraded }) =>
                  notify(
                    degraded
                      ? t('已恢复 {{count}} 个标签；未能读取窗口现状，可能多开了已经打开着的页面', {
                          count
                        })
                      : t('已恢复 {{count}} 个标签', { count })
                  )
                )
                .catch((error: unknown) =>
                  useUndoStore
                    .getState()
                    .notifyFailure('sidepanel', t('操作失败，请稍后重试'), error)
                );
            }}
            onCancel={() => setPendingHistoryRestore(null)}
          />
        )}
        {showSnapshots && (
          <SnapshotsPanel
            initialView={snapshotView}
            onClose={closeLayer}
            onCleanDuplicates={closeDuplicates}
            onDiscardInactive={discardInactive}
            onArchiveWindow={requestArchive}
          />
        )}
        {/* 归档确认：与恢复确认对称的破坏性动作闸门（不阻断高频操作）。 */}
        {pendingArchiveCount !== null && (
          <ConfirmDialog
            title={t('归档当前窗口（关闭并保存）')}
            message={t('将关闭 {{count}} 个标签并归档为快照，可撤销。归档失败不会关闭任何标签。', {
              count: pendingArchiveCount
            })}
            danger
            confirmLabel={t('归档')}
            onConfirm={performArchive}
            onCancel={() => setPendingArchiveCount(null)}
          />
        )}
        {/* 切换工作区确认：同样是「关 N 开 M」，只有归档拦一道而切换不拦的话，
            就是破坏力度不对称的缺口（误点一个 chip 就清空当前窗口）。 */}
        {pendingSwitch !== null && (
          <ConfirmDialog
            title={t('切换工作区')}
            message={t(
              '将关闭当前窗口 {{count}} 个标签并切换到「{{name}}」。关闭的标签可通过撤销找回。',
              { count: pendingSwitch.closableCount, name: pendingSwitch.target.name }
            )}
            danger
            confirmLabel={t('切换')}
            onConfirm={confirmSwitch}
            onCancel={cancelSwitch}
          />
        )}
        {!settings.onboarded && dataReady && showTour && (
          // 引导已完整讲过功能清单与固定空间概念（磁贴 vs 文件夹），完成引导即
          // 同步收起三层引导（Tour / Tip Banner / 固定空间概念卡）中的后两层，
          // 避免"关完一层还有一层"（概念卡仍可从设置页「固定概念一览」随时查看）。
          // Esc 走 onDismiss：仅本次关闭不落盘，下次打开面板可再次查看。
          <OnboardingTour
            onDone={() => {
              void tryUpdateSettings({ onboarded: true, tipSeen: true, conceptsSeen: true });
            }}
            onDismiss={() => setShowTour(false)}
            onExport={handleExportBackup}
          />
        )}
        {showPalette && (
          <CommandPalette
            tabs={tabs}
            folders={folders}
            actions={paletteActions}
            onClose={closeLayer}
          />
        )}
      </DndRoot>
    </main>
  );
}
