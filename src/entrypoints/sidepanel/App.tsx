import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DuplicateIndex, KeeperPolicy } from '@/core/dup/DuplicateIndex';
import { planRegroup } from '@/core/group/AutoGrouping';
import { canSafelyDiscardTab, NO_GROUP } from '@/core/tab-types';
import type { TabRecord } from '@/core/tab-types';
import {
  activateTabAcrossWindows,
  detectLanguage,
  onTabHighlighted,
  reloadTabs
} from '@/platform/tabs';
import { openOptionsPage } from '@/platform/navigation';
import { autoDiscardRepository } from '@/platform/storage/repositories';
import { regroupTempArea } from '@/platform/group/AutoGroupSync';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import i18n from '@/i18n';
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
import { DndRoot } from '@/ui/dnd/DndRoot';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { FixedArea } from '@/ui/fixed/FixedArea';
import { PinnedStrip } from '@/ui/fixed/PinnedStrip';
import { SearchBar } from '@/ui/search/SearchBar';
import { SectionList, splitPartnerIds } from '@/ui/tabs/SectionList';
import { pulseTabRows, useLocateActive } from '@/entrypoints/sidepanel/useLocateActive';
import { useAutoGroupSync } from '@/entrypoints/sidepanel/hooks/useAutoGroupSync';
import { useSearchController } from '@/entrypoints/sidepanel/hooks/useSearchController';
import { useSectionDerivation } from '@/entrypoints/sidepanel/hooks/useSectionDerivation';
import { useGlobalHotkeys } from '@/entrypoints/sidepanel/hooks/useGlobalHotkeys';
import { useListNavigation } from '@/entrypoints/sidepanel/hooks/useListNavigation';
import { usePendingActions } from '@/entrypoints/sidepanel/hooks/usePendingActions';
import { SortablePinnedTile } from '@/ui/tabs/SortablePinnedTile';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { FooterToolbar } from '@/entrypoints/sidepanel/FooterToolbar';
import {
  EmptyTabs,
  LoadErrorState,
  LoadingSkeleton,
  NoSearchResults
} from '@/entrypoints/sidepanel/ListStates';
import { useTabDragHandlers } from '@/entrypoints/sidepanel/useTabDragHandlers';

/**
 * 重复清理计划：可关闭的标签 + 每个重复组保留的 keeper id。
 *
 * 抽成模块级纯函数：清理按钮的「可清理数」徽章与清理动作本身必须基于同一份
 * 计算（否则会出现「徽章显示 3 个，点下去说没有」这类不一致）；keepIds 供
 * 清理后的脉冲高亮使用，让「保留了谁」可见。
 * 固定空间绑定的标签豁免：用户显式保存的资产不参与自动清理。
 */
function planDuplicateCleanup(
  index: DuplicateIndex,
  boundTabIds: readonly number[]
): { removable: TabRecord[]; keepIds: number[] } {
  const removable: TabRecord[] = [];
  const keepIds: number[] = [];
  for (const group of index.duplicates()) {
    const { keeper, removable: groupRemovable } = KeeperPolicy.default.select(group);
    keepIds.push(keeper.id);
    for (const tab of groupRemovable) {
      if (!boundTabIds.includes(tab.id)) removable.push(tab);
    }
  }
  return { removable, keepIds };
}

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
  const undoBatchCount = useUndoStore((state) => state.batches.length);
  const snapshotCount = useSnapshotStore((state) => state.snapshots.length);

  const [quickRegrouping, setQuickRegrouping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  // 引导延迟挂载：让用户先看到真实列表一眼，再弹出介绍（边看边学）。
  const [showTour, setShowTour] = useState(false);
  // 数据初始化自动重试仍失败：从骨架屏转为错误态（说明 + 手动重试），
  // 否则用户会永久停在一个没有出口的骨架屏上。
  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * 用户主动滚动后的一段静默期（防"抢滚"）：静默中不自动跟随激活标签滚动。
   *
   * 必须用 state 而非 ref：ref 变化不触发重渲染，而本值需要在滚动结束后
   * 被重新求值并下传给 SectionList——用 ref 会导致「滚动后 800ms 内禁用跟随」
   * 只能靠其他 state 碰巧变化才生效，语义失效。
   */
  const [userScrollActive, setUserScrollActive] = useState(false);
  const userScrollTimerRef = useRef(0);
  const markUserScroll = useCallback(() => {
    setUserScrollActive(true);
    window.clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = window.setTimeout(() => setUserScrollActive(false), 800);
  }, []);
  // 卸载时清理定时器，避免对已卸载组件 setState。
  useEffect(() => () => window.clearTimeout(userScrollTimerRef.current), []);

  /**
   * 智能激活：目标标签在其他窗口时先聚焦窗口再激活（全窗口搜索用）。
   *
   * 刻意不依赖 effectiveTabs / currentWindowId：二者在搜索输入时每次都变，
   * 会让 smartActivate → sectionCallbacks → SectionList 的 memo 链整条失效。
   * 改为读取 store 实时值，与同文件其他 handler 的 getState() 写法一致。
   */
  const smartActivate = useCallback(
    (tabId: number) => {
      const { tabs: liveTabs, currentWindowId: liveWindowId } = useTabStore.getState();
      const tab = (liveTabs as TabRecord[]).find((candidate) => candidate.id === tabId);
      if (tab && tab.windowId !== liveWindowId) {
        return activateTabAcrossWindows({ id: tab.id, windowId: tab.windowId });
      }
      return activateTab(tabId);
    },
    [activateTab]
  );

  // 常驻搜索：查询状态 / 引擎 / 命中 / 禁缓存角标集。
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
    handleSearchKeyDown
  } = useSearchController({
    tabs,
    t,
    searchAllWindows: settings.searchAllWindows,
    pinyinSearch: settings.pinyinSearch,
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
      notify(i18n.t('discard.autoDiscarded', { count: batch.count }), {
        label: i18n.t('discard.wakeAll'),
        run: async () => {
          const woken = (await reloadTabs(batch.tabIds)).length;
          await autoDiscardRepository.write(null);
          useUndoStore.getState().notify(i18n.t('discard.woken', { count: woken }));
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
  /** 定位激活标签（快捷键、挂起动作、命令面板共用）。 */
  const locateActiveViaRef = useCallback(() => locateActiveRef.current(), []);
  /** 重复标签复用提示。 */
  const notifyDuplicateReused = useCallback(() => notify(i18n.t('duplicates.reused')), [notify]);
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

  // 面板全局快捷键：⌘/Ctrl + P 命令面板、+ J 定位激活标签、+ K 搜索。
  useGlobalHotkeys({
    openPalette,
    locateActive: locateActiveViaRef,
    focusSearch: focusSearchInput
  });

  // 同步服务：事件 → 快照 → store 订阅自动重渲染。
  // 依赖里刻意不含 `t`：语言切换会导致 t 引用变化，进而重放整个数据层初始化
  // （重读全部仓库 + 重新订阅标签事件），切换一次语言等于重启一次面板。
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    // 初始化失败时 toast 并自动重试一次（dataStore 已回滚 initialized 守卫，允许重入），
    // 避免面板永久停在 Loading 骨架屏。
    void initializeData().catch(() => {
      if (cancelled) return;
      notify(i18n.t('errors.dataLoadFailed'));
      retryTimer = window.setTimeout(() => {
        void initializeData().catch(() => {
          // 自动重试仍失败：转错误态（手动重试 / 重新打开面板），不再静默。
          if (!cancelled) setLoadFailed(true);
        });
      }, 1000);
    });
    void loadUndo();
    void useSnapshotStore.getState().load();
    const stopSync = startTabSync();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
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

  // 自动休眠台账：面板打开时若有未撤销批次，提示可一键唤醒
  useEffect(() => {
    void autoDiscardRepository
      .read()
      .then((batch) => {
        if (batch && batch.tabIds.length > 0) showDiscardUndoToast(batch);
      })
      .catch(() => {});
  }, [showDiscardUndoToast]);

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
   * 一键清理重复标签：每个网址保留「激活 > 固定 > 位置靠前」的一个（固定标签豁免），
   * 关闭其余可清理者。走既有 closeWithUndo 管线 —— 清理同样进撤销栈、可一键反悔。
   * 固定空间绑定的标签额外豁免：那是用户显式保存的资产，不能被自动清理。
   *
   * 清理后对「保留项」播放一次脉冲高亮：结果不再只是一个数量，
   * 用户能看到每个域名留下了哪一个（否则只能靠撤销后反推）。
   */
  const handleCloseDuplicates = useCallback(() => {
    const liveTabs = useTabStore.getState().tabs;
    const plan = planDuplicateCleanup(
      DuplicateIndex.build(liveTabs),
      useDataStore.getState().boundTabIds
    );
    if (plan.removable.length === 0) {
      // 入口条件出现（>0 才显示），但命令面板常驻：无候选时不能静默。
      notify(t('duplicates.cleanNone'));
      return;
    }
    void closeWithUndo(
      liveTabs,
      plan.removable.map((tab) => tab.id)
    );
    // 关闭是异步的（tabs 事件回灌后才移除行）；保留项始终在 DOM 里，可立即脉冲。
    window.setTimeout(() => pulseTabRows(plan.keepIds), 80);
  }, [closeWithUndo, notify, t]);
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
          notify(t('errors.operationFailed'));
          return;
        }
        notify(t(tab.pinned ? 'toast.unpinned' : 'toast.pinned'));
        // 固定↔取消固定会改变标签在分组的归属（置顶区 ↔ 站点分组/未分组）：
        // 主动刷新快照，让标签立即按新 pinned 状态归类，不依赖事件回灌时序。
        tabSyncService.requestRefresh();
      });
    },
    [togglePinned, notify, t]
  );
  const handleDuplicateTab = useCallback(
    (tab: TabRecord) => {
      void duplicateTab(tab.id).then((ok) =>
        notify(t(ok ? 'toast.duplicated' : 'errors.operationFailed'))
      );
    },
    [duplicateTab, notify, t]
  );
  const handleDiscardTab = useCallback(
    (tab: TabRecord) => {
      if (!canSafelyDiscardTab(tab) || useDataStore.getState().boundTabIds.includes(tab.id)) {
        notify(t('toast.discardSkipped'));
        return;
      }
      void discardTab(tab.id).then((discarded) =>
        notify(discarded ? t('toast.discarded') : t('toast.discardSkipped'))
      );
    },
    [discardTab, notify, t]
  );
  // 一键休眠全部非激活、未固定的标签（释放内存）。
  const handleDiscardInactive = useCallback(() => {
    void (async () => {
      const allInactive = useTabStore
        .getState()
        .tabs.filter((tab) => !tab.active && !tab.discarded);
      const targets = allInactive.filter(
        (tab) => !boundTabIds.includes(tab.id) && canSafelyDiscardTab(tab)
      );
      // 无任何候选时必须给反馈（FooterToolbar / 命令面板按钮恒可用）：
      // 静默空跑会被当成「按钮坏了」。
      if (targets.length === 0 && allInactive.length === 0) {
        notify(t('discard.allInactiveNone'));
        return;
      }
      const results = await Promise.all(targets.map((tab) => discardTab(tab.id)));
      const discardedCount = results.filter(Boolean).length;
      const skippedCount = allInactive.length - discardedCount;
      if (discardedCount > 0) {
        notify(
          skippedCount === 0
            ? t('toast.discardedMany', { count: discardedCount })
            : t('toast.discardedManySkipped', { count: discardedCount, skipped: skippedCount })
        );
      } else if (allInactive.length > 0) {
        notify(t('toast.discardSkippedMany', { count: allInactive.length }));
      }
    })();
  }, [boundTabIds, discardTab, notify, t]);
  // 一键唤醒全部休眠标签（与批量休眠成对）。
  const handleWakeAll = useCallback(() => {
    const discardedIds = useTabStore
      .getState()
      .tabs.filter((tab) => tab.discarded)
      .map((tab) => tab.id);
    if (discardedIds.length === 0) {
      // 命令面板/底栏入口恒可用：无休眠标签时点按不能静默。
      notify(t('discard.wakeNone'));
      return;
    }
    void reloadTabs(discardedIds).then((woken) =>
      notify(t('discard.woken', { count: woken.length }))
    );
  }, [notify, t]);
  const discardedCount = tabs.filter((tab) => tab.discarded).length;
  // 原生标签组 → 固定文件夹（桥接反向）。
  const handleSaveGroupAsFolder = useCallback(
    (groupId: number) => {
      const name =
        useTabStore.getState().groups.find((g) => g.id === groupId)?.title ||
        t('tabs.unnamedGroup');
      const groupTabs = useTabStore.getState().tabs.filter((tab) => tab.groupId === groupId);
      void createFolderFromNativeGroup(name, groupTabs).then((saved) =>
        // 组内无可收藏网页标签时不建空夹（返回 false），用区分文案而非“已保存”。
        notify(t(saved ? 'toast.savedAsFolder' : 'fixed.saveEmpty'))
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
      notify(t('footer.quickRegroupNone'));
      return;
    }
    setQuickRegrouping(true);
    void regroupTempArea(plan.ungroupTabIds, plan.plans)
      .then((count) => {
        // 快速整理直接打散并重建浏览器原生组：显式请求快照刷新，让整理结果
        // 立即呈现（与事件驱动刷新共用 signal 合并，不会重复查询）。
        tabSyncService.requestRefresh();
        notify(t('footer.quickRegroupDone', { count }));
      })
      .catch(() => notify(t('errors.operationFailed')))
      .finally(() => setQuickRegrouping(false));
  }, [
    quickRegrouping,
    tabs,
    fixedExcludedTabIds,
    settings.groupMode,
    settings.aggregationThreshold,
    notify,
    t
  ]);

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
      onMoveTab: handleMoveTab
    }),
    [
      smartActivate,
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

  // 命令面板动作集合（⌘P）：复用既有 handler。必须 memo 化：面板打开期间每次
  // 标签快照都重建 actions 引用，会让 CommandPalette 的 commands 重算、索引钳制与
  // scrollIntoView effect 反复执行。
  const paletteActions: PaletteActions = useMemo(
    () => ({
      onDiscardInactive: handleDiscardInactive,
      onWakeAll: handleWakeAll,
      onQuickRegroup: handleQuickRegroup,
      onCleanDuplicates: handleCloseDuplicates,
      onLocateActive: handleLocateActive,
      onOpenHistory: () => setShowHistory(true),
      onOpenSettings: openOptionsPage,
      onToggleAllSections: handleToggleAllSections,
      onSwitchTab: (tabId: number) => void smartActivate(tabId),
      onOpenSnapshots: () => setShowSnapshots(true),
      onSaveSnapshot: () =>
        void useSnapshotStore
          .getState()
          .saveCurrentWindow()
          .then(() => notify(t('snapshots.saved')))
          .catch(() => notify(t('errors.operationFailed'))),
      onSaveSpace: () =>
        void useSnapshotStore
          .getState()
          .saveSpace(t('snapshots.space'))
          .then(() => notify(t('snapshots.saved')))
          .catch(() => notify(t('errors.operationFailed'))),
      onArchiveWindow: () =>
        void useSnapshotStore
          .getState()
          .archiveCurrentWindow()
          .then((count) => notify(t('snapshots.archived', { count })))
          .catch(() => notify(t('errors.operationFailed')))
    }),
    [
      handleDiscardInactive,
      handleWakeAll,
      handleQuickRegroup,
      handleCloseDuplicates,
      handleLocateActive,
      handleToggleAllSections,
      smartActivate,
      notify,
      t
    ]
  );

  return (
    <main className="app flex h-full flex-col">
      <DndRoot onDragEnd={onDragEnd}>
        <SettingsSync />
        <SearchBar
          query={query}
          onChange={setQuery}
          inputRef={searchInputRef}
          onKeyDown={handleSearchInputKeyDown}
          /* 有可选项才允许提示（聚焦时显示）：空态同样支持漫游，故不再要求先输入 */
          showKeyboardHint={isFiltering ? filteredTabs.length > 0 : tabs.length > 0}
        />
        {/* 搜索命中数对读屏播报（<output> 原生隐含 role=status；视觉用户有列表过滤反馈，读屏用户此前无感知） */}
        <output className="sr-only" aria-live="polite">
          {isFiltering ? t('search.hits', { count: filteredTabs.length }) : ''}
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
              {t('errors.storageDegraded')}
            </p>
          </div>
        )}
        {/* 一次性「能力发现」Tip：仅首次展示。刻意排在搜索框之后——搜索是本面板最高频入口，
            教学性内容不得把它挤出首屏顶部。 */}
        {!settings.tipSeen && (
          <div className="mx-1 mb-1 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2">
            <Icon d={Icons.sparkles} className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
            <div className="min-w-0 flex-1">
              <p className="text-3xs font-semibold text-accent-700">{t('tips.discoverTitle')}</p>
              <p className="mt-0.5 text-3xs leading-relaxed text-accent-700/90">
                {t('tips.discoverBody')}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-3xs font-medium text-accent-700 transition-base hover:bg-accent-100"
              onClick={() => void tryUpdateSettings({ tipSeen: true })}
            >
              {t('tips.gotIt')}
            </button>
          </div>
        )}
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
            <div className="section-body">
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
                      unpinTitle={t('tabs.unpin')}
                    />
                  ))}
                </div>
              </SortableContext>
            </div>
          </CategoryModule>
        )}
        <div className="px-1 py-0.5">
          <FixedArea />
        </div>
        <StatusToast />
        <div
          className="flex-1 overflow-y-auto px-1 py-0.5"
          onWheel={markUserScroll}
          onTouchMove={markUserScroll}
        >
          {!dataReady ? (
            loadFailed ? (
              /* 自动重试仍失败：给出说明与手动出口，不留无出口的骨架屏 */
              <LoadErrorState onRetry={handleRetryLoad} />
            ) : (
              // 加载骨架：区分「同步中」与「真的没有标签」
              <LoadingSkeleton />
            )
          ) : tabs.length === 0 ? (
            <EmptyTabs />
          ) : isFiltering && filteredTabs.length === 0 ? (
            <NoSearchResults onClear={() => setQuery('')} />
          ) : (
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
              callbacks={sectionCallbacks}
            />
          )}
        </div>

        <div className="add-tab-bar">
          <button type="button" className="add-tab-btn" onClick={() => void createNewTab()}>
            <Icon d={Icons.plus} className="h-4 w-4" />
            <span>{t('tabs.newTab')}</span>
          </button>
        </div>

        <FooterToolbar
          tabCount={tabs.length}
          footerLabels={settings.footerLabels}
          collapsibleCount={collapsibleSections.length}
          allCollapsed={allSectionsCollapsed}
          activeTabId={activeTabId}
          discardedCount={discardedCount}
          duplicateCount={duplicateRemovableCount}
          highlightedCount={highlightedIds.size}
          quickRegrouping={quickRegrouping}
          onToggleAllSections={handleToggleAllSections}
          onDiscardInactive={handleDiscardInactive}
          onWakeAll={handleWakeAll}
          onQuickRegroup={handleQuickRegroup}
          onCleanDuplicates={handleCloseDuplicates}
          onCloseHighlighted={handleCloseHighlighted}
          onLocateActive={handleLocateActive}
          onOpenHistory={() => setShowHistory(true)}
          onOpenSettings={openOptionsPage}
          onOpenSnapshots={() => setShowSnapshots(true)}
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
        {showSnapshots && <SnapshotsPanel onClose={() => setShowSnapshots(false)} />}
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
          />
        )}
        {showPalette && (
          <CommandPalette
            tabs={tabs}
            actions={paletteActions}
            onClose={() => setShowPalette(false)}
          />
        )}
      </DndRoot>
    </main>
  );
}
