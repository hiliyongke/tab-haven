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
import type { TemporarySection } from '@/core/site/Sections';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import {
  activateTabAcrossWindows,
  createTabsWithUrls,
  detectLanguage,
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
import { logFailure } from '@/platform/diagnostics';
import { regroupTempArea } from '@/platform/group/AutoGroupSync';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { translate, useTranslation } from '@/i18n';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { Icon, Icons } from '@/ui/common/Icon';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { StatusToast } from '@/ui/common/StatusToast';
import { UndoHistoryPanel } from '@/ui/common/UndoHistoryPanel';
import { SnapshotsPanel } from '@/ui/common/SnapshotsPanel';
import { OnboardingTour } from '@/ui/common/OnboardingTour';
import { CommandPalette, type PaletteActions } from '@/ui/common/CommandPalette';
import { SpaceStrip } from '@/ui/common/SpaceStrip';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { DndRoot } from '@/ui/dnd/DndRoot';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { FixedArea } from '@/ui/fixed/FixedArea';
import { PinnedStrip } from '@/ui/fixed/PinnedStrip';
import { SearchBar } from '@/ui/search/SearchBar';
import { SectionList, splitPartnerIds } from '@/ui/tabs/SectionList';
import { pulseTabRows, useLocateActive } from '@/entrypoints/sidepanel/useLocateActive';
import { useAutoGroupSync } from '@/entrypoints/sidepanel/hooks/useAutoGroupSync';
import { useSearchController } from '@/ui/search/useSearchController';
import { HistoryHitsSection } from '@/ui/search/HistoryHitsSection';
import { useSectionDerivation } from '@/entrypoints/sidepanel/hooks/useSectionDerivation';
import { useGlobalHotkeys } from '@/entrypoints/sidepanel/hooks/useGlobalHotkeys';
import { useSpaces } from '@/entrypoints/sidepanel/hooks/useSpaces';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';
import { useOtherWindows } from '@/ui/tabs/useOtherWindows';
import { OtherWindowsSection } from '@/ui/tabs/OtherWindowsSection';
import { RestoreConfirmDialog } from '@/ui/common/RestoreConfirmDialog';
import type { Snapshot } from '@/core/schema/models';
import { useListNavigation } from '@/entrypoints/sidepanel/hooks/useListNavigation';
import { usePendingActions } from '@/entrypoints/sidepanel/hooks/usePendingActions';
import { SortablePinnedTile } from '@/ui/tabs/SortablePinnedTile';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { FooterToolbar } from '@/entrypoints/sidepanel/FooterToolbar';
import { computeInsights } from '@/core/insights/tabInsights';
import {
  EmptyTabs,
  LoadErrorState,
  LoadingSkeleton,
  NoSearchResults
} from '@/ui/common/ListStates';
import { useTabDragHandlers } from '@/entrypoints/sidepanel/useTabDragHandlers';

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
  const moveGroup = useTabStore((state) => state.moveGroup);
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
  /** 完整快照列表（P-01 时间线搜索索引源；仅引用变化时重建引擎）。 */
  const snapshots = useSnapshotStore((state) => state.snapshots);

  const [quickRegrouping, setQuickRegrouping] = useState(false);
  /**
   * 批量操作（休眠全部 / 唤醒全部 / 清理重复）的在途互斥。
   *
   * 这些入口此前没有并发守卫：连点会并发执行同一批操作（重复 IPC、叠加多条
   * toast）。
   *
   * 用 state 而非 ref：ref 不触发重渲染，在途期间按钮既不禁用也没有进行中态，
   * 而「唤醒全部」是 reloadTabs(N 个标签)、耗时远超注释里假设的百毫秒级 ——
   * 用户连点第二下完全静默，表现为「点了没反应」。在途必须可感知。
   */
  const [batchBusy, setBatchBusy] = useState<'idle' | 'discard' | 'wake' | 'clean'>('idle');
  const runBatch = useCallback(
    (kind: 'discard' | 'wake' | 'clean', action: () => void | Promise<void>) => {
      if (batchBusy !== 'idle') return;
      setBatchBusy(kind);
      void Promise.resolve(action()).finally(() => {
        setBatchBusy('idle');
      });
    },
    [batchBusy]
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  /**
   * 快照面板的初始视图（F-1 习惯洞察直达）：
   * 'list' = 常规打开（快照列表）；'report' = 从底栏洞察入口打开，直接落在周报 /
   * 洞察区块，省掉「打开面板 → 切页签」这一步。
   */
  const [snapshotView, setSnapshotView] = useState<'list' | 'report'>('list');
  // 工作空间切换（C1）：编排逻辑抽在 hook，App 只消费结果。
  const { spaces, activeSpaceId, switching, switchSpace, exitSpace, saveAsSpace } = useSpaces();
  // 其他窗口分段（A4）的 hook 在 useSearchController 之后调用（依赖 isFiltering）。
  const handleOtherWindowFocus = useCallback((tab: TabRecord) => {
    void activateTabAcrossWindows({ id: tab.id, windowId: tab.windowId });
  }, []);
  const handleOtherWindowClose = useCallback((tab: TabRecord) => {
    // 走统一撤销批次：误关其他窗口标签与误关当前标签同一找回体验。
    void useUndoStore.getState().closeWithUndo([tab], [tab.id]);
  }, []);

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
   * 此前是 800ms 静默期：静默一过就会再次跟随，而用户往往正停在半路找另一个
   * 标签——被拉回去是纯粹的干扰。改为「接管 / 交还」语义后，跟随只在用户明确
   * 切换或定位时恢复。
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

  // 常驻搜索：查询状态 / 引擎 / 命中 / 禁缓存角标集 / 历史命中（P-01）。
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
  const locateActiveRef = useRef(handleLocateActive);
  // 提交后更新而非渲染期赋值：并发渲染下渲染可能不提交，渲染期写 ref 会把
  // 未提交的中间值泄漏给事件监听（与 SectionList/VirtualRowList/FolderRow 的约定一致）。
  useEffect(() => {
    locateActiveRef.current = handleLocateActive;
  }, [handleLocateActive]);

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
  const locateActiveViaRef = useCallback(() => {
    releaseScrollControl();
    locateActiveRef.current();
  }, [releaseScrollControl]);
  /** 重复标签复用提示。 */
  const notifyDuplicateReused = useCallback(
    () => notify(translate('已切到已打开的标签，并关掉重复的那个')),
    [notify]
  );
  /** 打开命令面板。 */
  const openPalette = useCallback(() => setShowPalette(true), []);

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
    // undo 内部有 undoInFlight 互斥与空栈静默，键盘连按安全。
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
    void initializeData().catch(() => {
      if (cancelled) return;
      notify(translate('数据加载失败，请检查扩展权限'));
      retryTimerRef.current = window.setTimeout(() => {
        void initializeData().catch(() => {
          // 自动重试仍失败：转错误态（手动重试 / 重新打开面板），不再静默。
          if (!cancelled) setLoadFailed(true);
        });
      }, 1000);
    });
    void loadUndo().catch((error: unknown) => {
      logFailure('sidepanel', '撤销历史加载失败', error);
    });
    void useSnapshotStore.getState().load();
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

  // 快捷键（useGlobalHotkeys）与 runtime 消息分发（usePendingActions）已各自抽为独立
  // hook：原先两者挤在同一个 effect 里，依赖数组含消息侧回调，导致切标签 / 语言变化时
  // 快捷键监听被连带解绑重绑。拆开后语义不变而重挂次数下降。

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

  // 首启引导延迟弹出：数据就绪后先让用户看到真实列表约 0.9s，
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
    }, 900);
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
    baseSections,
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
   * 固定磁贴区在前，其后是各未折叠分区。折叠分区内的标签**不进序列**：
   * 它们在 DOM 里不存在，选中一个看不见的标签会让 Enter 变成「激活未知项」。
   */
  const roamTabIds = useMemo(() => {
    // displayCollapsedSites 是「Set 或数组」的联合类型（与 SectionList 的入参同源），
    // 这里统一成 Set 再查询。
    const collapsedSitesSet =
      displayCollapsedSites instanceof Set ? displayCollapsedSites : new Set(displayCollapsedSites);
    const ids: number[] = [];
    if (settings.showPinnedStrip && pinnedSection) {
      for (const tab of pinnedSection.tabs) ids.push(tab.id);
    }
    for (const section of restSections) {
      const collapsed =
        section.kind === 'native'
          ? displayCollapsedGroups.has(section.groupId)
          : section.kind === 'site'
            ? collapsedSitesSet.has(section.siteKey)
            : false;
      if (collapsed) continue;
      for (const tab of section.tabs) ids.push(tab.id);
    }
    return ids;
  }, [
    settings.showPinnedStrip,
    pinnedSection,
    restSections,
    displayCollapsedGroups,
    displayCollapsedSites
  ]);

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

  // 自动原生分组：把聚合结果落成浏览器 tabGroups / 关闭时解散（细则见该 hook 注释）。
  useAutoGroupSync({
    sections: baseSections,
    autoGroupNative: settings.autoGroupNative,
    groupMode: settings.groupMode
  });

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
   * 习惯洞察条数（R16 / F-1）。
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
      .catch(() => {
        // detectLanguage 内部有 'und' 兜底，此处兜住意外 rejection（polyfill
        // 边界/API 异常路径）：必须清理 in-flight 登记，否则这些标签永远
        // 失去再探测机会，且产生 unhandled rejection。
        for (const tab of eligible) langInFlightRef.current.delete(tab.id);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.groupMode, tabs]);

  /** 手动重试数据初始化（自动重试失败后错误态的出口）。 */
  const handleRetryLoad = useCallback(() => {
    setLoadFailed(false);
    void initializeData().catch(() => setLoadFailed(true));
  }, [initializeData]);

  /**
   * 关闭浏览器多选（Ctrl+Click）的标签。
   *
   * 此前多选高亮只同步了视觉、没有任何操作出口 —— 用户选中几个标签后会
   * 尝试「一起关掉」，发现不行。这里补上出口（走既有撤销管线，可反悔）。
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
   * 产品决策 D2（2026-09-30）：批量动作用「**影响面提示**」而非「强制确认弹窗」——
   * 点击即执行，不给高频用户加摩擦。影响面由两处承载：
   *   ① 执行前：底栏入口徽章/`title` 上的待清理数量（见 sleepableCount 同款口径）；
   *   ② 执行后：`closeWithUndo` 的回执（已关闭数）与保留项脉冲。
   * 清理本身进撤销栈、可一键反悔，因此不需要阻断式确认。
   */
  const handleCloseDuplicates = useCallback(() => {
    runBatch('clean', () => {
      const liveTabs = useTabStore.getState().tabs;
      const plan = planDuplicateCleanup(
        DuplicateIndex.build(liveTabs),
        useDataStore.getState().boundTabIds
      );
      if (plan.removable.length === 0) {
        // 入口条件出现（>0 才显示），但命令面板常驻：无候选时不能静默。
        notify(t('没有可清理的重复标签'));
        return;
      }
      // 关闭是异步的（tabs 事件回灌后才移除行）；保留项始终在 DOM 里，可立即脉冲。
      window.setTimeout(() => pulseTabRows(plan.keepIds), 80);
      return closeWithUndo(
        liveTabs,
        plan.removable.map((tab) => tab.id)
      );
    });
  }, [runBatch, closeWithUndo, notify, t]);
  /**
   * 固定/取消固定带 toast 反馈。
   *
   * 此前这两处操作完全静默：标签会移动到固定区，但当 `showPinnedStrip` 关闭、
   * 或固定区折叠/滚出视野时，用户在扩展内看不到任何变化（只能从浏览器原生标签栏察觉），
   * 会怀疑「点了没生效」。文案 toast.pinned / toast.unpinned 早已就位，此前未接线。
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
  // 一键休眠全部后台标签、未固定的标签（释放内存）。
  const handleDiscardInactive = useCallback(() => {
    runBatch('discard', async () => {
      const allInactive = useTabStore
        .getState()
        .tabs.filter((tab) => !tab.active && !tab.discarded);
      // 与底栏入口提示同一口径（selectSleepableTabs）：避免「提示 N 个、实际休眠 M 个」。
      const targets = selectSleepableTabs(allInactive, boundTabIds);
      // 无任何候选时必须给反馈（FooterToolbar / 命令面板按钮恒可用）：
      // 静默空跑会被当成「按钮坏了」。
      if (targets.length === 0 && allInactive.length === 0) {
        notify(t('没有可休眠的后台标签'));
        return;
      }
      const results = await Promise.all(targets.map((tab) => discardTab(tab.id)));
      const discardedCount = results.filter(Boolean).length;
      // 跳过数只统计「真正尝试过」的候选（targets 已排除绑定标签与不可安全休眠者）：
      // 用 allInactive 作基数会把固定标签也计入「跳过 N 个」，而它们本就不该参与休眠。
      const skippedCount = targets.length - discardedCount;
      if (discardedCount > 0) {
        notify(
          skippedCount === 0
            ? t('已休眠 {{count}} 个标签', { count: discardedCount })
            : t('已休眠 {{count}} 个标签，另有 {{skipped}} 个正在使用中已跳过', {
                count: discardedCount,
                skipped: skippedCount
              })
        );
      } else if (targets.length > 0) {
        notify(t('{{count}} 个标签正在使用中，已跳过', { count: targets.length }));
      } else {
        notify(t('没有可休眠的后台标签'));
      }
    });
  }, [runBatch, boundTabIds, discardTab, notify, t]);
  // 一键唤醒全部休眠标签（与批量休眠成对）。
  const handleWakeAll = useCallback(() => {
    runBatch('wake', () => {
      const discardedIds = useTabStore
        .getState()
        .tabs.filter((tab) => tab.discarded)
        .map((tab) => tab.id);
      if (discardedIds.length === 0) {
        // 命令面板/底栏入口恒可用：无休眠标签时点按不能静默。
        notify(t('当前没有休眠中的标签'));
        return;
      }
      return reloadTabs(discardedIds).then((woken) =>
        notify(t('已唤醒 {{count}} 个标签', { count: woken.length }))
      );
    });
  }, [runBatch, notify, t]);
  /**
   * 归档当前窗口：先给影响面确认（将关闭 N 个标签），确认后才真正执行。
   *
   * 归档是一次性关掉整个窗口的破坏性动作，此前它与「恢复」的安全级别是反的：
   * 恢复（新建整批标签）强制确认，归档（关闭整批标签）点击即执行。
   * 归档虽可撤销，但栈深有限、后续关闭会把它挤掉 —— 误触即丢，必须拦一道。
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
      .catch(() => notifyError(t('操作失败，请稍后重试')));
  }, [notify, notifyError, t]);

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
      .catch(() => notifyError(t('导出失败：本地数据读取未完成')));
  }, [notify, notifyError, t]);

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
      const name =
        useTabStore.getState().groups.find((g) => g.id === groupId)?.title || t('未命名标签组');
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
  const handleMoveGroup = useCallback(
    (groupId: number, index: number) => void moveGroup(groupId, index),
    [moveGroup]
  );

  // 快速整理：完全重新初始化临时区分组 —— 打散现有临时区原生组（分组+未分组），
  // 按当前聚合方式重组全部非固定标签；固定区域（浏览器置顶/顶部固定磁贴/固定空间）不受影响。
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
    // 产品决策 D2（2026-09-30）：点击即执行，不弹确认。
    // 快速整理打散并重建浏览器原生组、不进撤销栈，是Tabs唯一不可反悔的破坏性动作，
    // 与「一切关闭都可反悔」的核心承诺冲突。因此执行前先存一份现场快照当回退点：
    // 存不进去就中止重排，绝不裸奔执行（与归档同款纪律：保存失败不关标签）。
    setQuickRegrouping(true);
    void (async () => {
      try {
        // 名字是落盘数据（会进导出备份），必须用常量而不是 t()：否则英文界面
        // 保存的是译文、中文界面是中文，同一批数据出现两种名字。
        await useSnapshotStore.getState().saveCurrentWindow(DEFAULT_SNAPSHOT_NAMES.regroup);
      } catch (error) {
        logFailure('sidepanel', '重排前保存现场快照失败，已取消重排', error);
        notifyError(t('无法保存重排前的现场快照，已取消重排（标签与分组未改动）'));
        return;
      }
      const count = await regroupTempArea(plan.ungroupTabIds, plan.plans);
      // 快速整理直接打散并重建浏览器原生组：显式请求快照刷新，让整理结果
      // 立即呈现（与事件驱动刷新共用 signal 合并，不会重复查询）。
      tabSyncService.requestRefresh();
      notify(t('已重新分组 {{count}} 个组 · 重排前现场已存入快照，可回退', { count }));
    })()
      .catch(() => notifyError(t('操作失败，请稍后重试')))
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
      onToggleMute: (tab: TabRecord) => void toggleMute(tab),
      onTogglePin: handleTogglePin,
      onCloseTab: handleCloseTab,
      onDuplicate: handleDuplicateTab,
      onDiscard: handleDiscardTab,
      onSaveGroupAsFolder: handleSaveGroupAsFolder,
      onGroupRename: handleRenameGroup,
      onGroupRecolor: handleRecolorGroup,
      onGroupMove: handleMoveGroup,
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
      handleMoveGroup,
      handleReorder,
      handleMoveTab
    ]
  );

  /**
   * 打开文件夹全部条目（P-04「文件夹即空间」命令面板出口）：
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
        .catch(() => notifyError(t('操作失败，请稍后重试')));
    },
    [notify, notifyError, t]
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
      onDiscardInactive: handleDiscardInactive,
      onWakeAll: handleWakeAll,
      onQuickRegroup: handleQuickRegroup,
      onCleanDuplicates: handleCloseDuplicates,
      onLocateActive: locateActiveViaRef,
      onOpenHistory: () => setShowHistory(true),
      onOpenSettings: openOptionsPage,
      // 信任面板此前只有「底栏设置 → 设置页 → 关于页」一条三步路径，
      // 而「自证零网络」是Tabs的核心卖点 —— 命令面板一次直达。
      onOpenAbout: openAboutPage,
      onToggleAllSections: handleToggleAllSections,
      onSwitchTab: (tabId: number) => void smartActivate(tabId),
      onOpenSnapshots: () => setShowSnapshots(true),
      onSaveSnapshot: () =>
        void useSnapshotStore
          .getState()
          .saveCurrentWindow()
          .then(() => notify(t('已保存快照')))
          .catch(() => notifyError(t('操作失败，请稍后重试'))),
      onSaveSpace: () =>
        // 与 useSpaces / SnapshotsPanel 同口径：不传名字，命名交给 store 的
        // fallbackName，避免把界面语言写进落盘快照名。
        void useSnapshotStore
          .getState()
          .saveSpace()
          .then(() => notify(t('已保存快照')))
          .catch(() => notifyError(t('操作失败，请稍后重试'))),
      onArchiveWindow: requestArchive,
      onOpenFolder: handleOpenFolder
    }),
    [
      handleDiscardInactive,
      handleWakeAll,
      handleQuickRegroup,
      handleCloseDuplicates,
      locateActiveViaRef,
      handleToggleAllSections,
      handleOpenFolder,
      requestArchive,
      smartActivate,
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
        .catch(() => notifyError(t('操作失败，请稍后重试')));
    },
    [notify, notifyError, t]
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
          .catch(() => notifyError(t('操作失败，请稍后重试')));
        return;
      }
      setPendingHistoryRestore(snapshot);
    },
    [notify, notifyError, t]
  );

  return (
    /* data-density 提到 .app：密度要覆盖固定空间与主列表两条渲染链。
       此前只挂在 SectionList 上，固定空间的条目行（不经 RowItem 的 density
       prop）切换档位时纹丝不动 —— 大字号档位「半途而废」。 */
    <main className="app flex h-full flex-col" data-density={settings.density}>
      {/* h1 此前完全缺失：侧边栏直接从 <main> 进入列表，标题层级断裂，
          读屏用户无法用「跳到标题」快速定位，也拿不到页面主题。
          视觉上隐藏——面板顶部已有搜索框与品牌标识，再加一个可见标题是噪音。 */}
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
        {/* 搜索命中数对读屏播报（<output> 原生隐含 role=status；视觉用户有列表过滤反馈，读屏用户此前无感知） */}
        <output className="sr-only" aria-live="polite">
          {isFiltering ? t('命中 {{count}} 个标签', { count: filteredTabs.length }) : ''}
        </output>
        {/* 落盘失败横幅：由「最近一次持久化是否成功」驱动（成功写会复位标志），
            因此它表达的是「此刻存储可能不可写」，而非「历史上有过失败」。
            宁可多提示一次，也不能让「界面显示成功、重启即丢」静默发生。 */}
        {storageDegraded && (
          <div
            role="alert"
            className="mx-1 mb-1 flex items-start gap-2 rounded-lg border border-warn-200 bg-warn-50 px-3 py-2"
          >
            <Icon d={Icons.infoAlert} className="mt-0.5 h-4 w-4 shrink-0 text-warn-600" />
            <p className="min-w-0 flex-1 text-3xs leading-relaxed text-warn-700">
              {t(
                '最近的改动可能没能保存到本地：请检查浏览器存储空间是否已满，或扩展权限是否被收回'
              )}
            </p>
          </div>
        )}
        {/* 一次性「能力发现」Tip：仅首次展示。刻意排在搜索框之后——搜索是本面板最高频入口，
            教学性内容不得把它挤出首屏顶部。 */}
        {!settings.tipSeen && (
          <div className="mx-1 mb-1 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2">
            <Icon d={Icons.sparkles} className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
            <div className="min-w-0 flex-1">
              <p className="text-3xs font-semibold text-accent-700">
                {t('三处入口用满 Tabs 的能力')}
              </p>
              <p className="mt-0.5 text-3xs leading-relaxed text-accent-700/90">
                {t(
                  '① 页面 / 链接 / 标签栏右键可休眠、固定、按域名搜索；② 地址栏输入 t 后输关键词直达；③ ⌘P（Ctrl+P）打开命令面板，一步执行休眠 / 存快照 / 开设置。'
                )}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-3xs font-medium text-accent-700 transition-base hover:bg-accent-100"
              onClick={() => void tryUpdateSettings({ tipSeen: true })}
            >
              {t('知道了')}
            </button>
          </div>
        )}
        {/* 工作空间切换条（C1）：无空间快照时整条隐藏。 */}
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
              <div className="pinned-grid">
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
        {/* 不加横向 padding：8px 内容竖线由 .section-head / .section-body 统一给出。
            此前这里套了一层 px-1(4px)，使固定空间与主列表整体右移 4px，
            与顶栏搜索图标（8px）、Toast（8px）、新建栏（8px）不同线。 */}
        <div className="py-0.5">
          <FixedArea />
        </div>
        <div
          /* overscroll-contain：这是「固定空间 → 主列表 → 虚拟列表」三层滚动链的中间层，
             内外两层都有隔离，唯独中间层没有 —— 内层滚到边界会带着主列表一起滚。 */
          className="flex-1 overflow-y-auto overscroll-contain py-0.5"
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
                setSnapshotView('list');
                setShowSnapshots(true);
              }}
            />
          ) : isFiltering && filteredTabs.length === 0 ? (
            <NoSearchResults onClear={() => setQuery('')} />
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
            />
          )}
        </div>

        {/* P-01 历史命中分区：仅过滤态且设置开启时展示；当前标签在上方列表，
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
          <button
            type="button"
            className="add-tab-btn"
            aria-label={t('新建标签')}
            title={t('新建标签')}
            onClick={() => void createNewTab()}
          >
            <Icon d={Icons.plus} className="h-4 w-4" />
            <span>{t('新建标签')}</span>
          </button>
        </div>

        {/* 提示条挂在「+ 新建标签」与底栏之间（实体占位，不再是浮层）：
            此前 absolute 浮层压在列表中间，会盖住用户正在操作的行。 */}
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
            setSnapshotView('report');
            setShowSnapshots(true);
          }}
          highlightedCount={highlightedIds.size}
          quickRegrouping={quickRegrouping}
          onToggleAllSections={handleToggleAllSections}
          // 在途态下传：对应入口在批量操作期间禁用，避免「点了没反应」
          batchBusy={batchBusy}
          onDiscardInactive={handleDiscardInactive}
          onWakeAll={handleWakeAll}
          onQuickRegroup={handleQuickRegroup}
          onCleanDuplicates={handleCloseDuplicates}
          onCloseHighlighted={handleCloseHighlighted}
          onLocateActive={locateActiveViaRef}
          onOpenHistory={() => setShowHistory(true)}
          onOpenSettings={openOptionsPage}
          // 信任面板（P-03）：底栏一次直达，与设置页「关于」同一入口。
          onOpenAbout={openAboutPage}
          onOpenSnapshots={() => {
            setSnapshotView('list');
            setShowSnapshots(true);
          }}
          undoBatchCount={undoBatchCount}
          snapshotCount={snapshotCount}
          onOpenPalette={() => setShowPalette(true)}
        />
        {showHistory && (
          <UndoHistoryPanel
            hasSnapshots={snapshotCount > 0}
            onOpenSnapshots={() => {
              setShowHistory(false);
              setShowSnapshots(true);
            }}
            onClose={() => setShowHistory(false)}
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
                .catch(() => notifyError(t('操作失败，请稍后重试')));
            }}
            onCancel={() => setPendingHistoryRestore(null)}
          />
        )}
        {showSnapshots && (
          <SnapshotsPanel
            initialView={snapshotView}
            onClose={() => setShowSnapshots(false)}
            onCleanDuplicates={handleCloseDuplicates}
            onDiscardInactive={handleDiscardInactive}
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
            onClose={() => setShowPalette(false)}
          />
        )}
      </DndRoot>
    </main>
  );
}
