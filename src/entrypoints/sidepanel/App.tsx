import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DuplicateIndex } from '@/core/dup/DuplicateIndex';
import { matchesNoCachePattern } from '@/platform/nocache/noCacheRules';
import { planAutoGroups, planRegroup } from '@/core/group/AutoGrouping';
import { SearchEngine } from '@/core/search/SearchEngine';
import { deriveSections } from '@/core/site/Sections';
import { canSafelyDiscardTab, NO_GROUP } from '@/core/tab-types';
import type { TabRecord } from '@/core/tab-types';
import {
  onRuntimeMessage,
  watchPendingActions,
  type Message,
  type PendingAction
} from '@/platform/messages';
import {
  activateTabAcrossWindows,
  detectLanguage,
  onTabHighlighted,
  reloadTabs
} from '@/platform/tabs';
import { openOptionsPage } from '@/platform/navigation';
import { logDegraded } from '@/platform/diagnostics';
import { autoDiscardRepository } from '@/platform/storage/repositories';
import { syncAutoGroups, disbandAutoGroups, regroupTempArea } from '@/platform/group/AutoGroupSync';
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
import { useLocateActive } from '@/entrypoints/sidepanel/useLocateActive';
import { SortablePinnedTile } from '@/ui/tabs/SortablePinnedTile';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { FooterToolbar } from '@/entrypoints/sidepanel/FooterToolbar';
import { EmptyTabs, LoadingSkeleton, NoSearchResults } from '@/entrypoints/sidepanel/ListStates';
import { useTabDragHandlers } from '@/entrypoints/sidepanel/useTabDragHandlers';
import { useAllWindowTabs } from '@/ui/common/useAllWindowTabs';

/**
 * 禁缓存规则未启用时返回的空 Set 单例。
 * 必须是模块级常量：useMemo 的空依赖不保证引用稳定，而本值是下游 noCacheTabIds
 * 的依赖项，引用变动会引发整条派生链重算。
 */
const EMPTY_NO_CACHE_SET: ReadonlySet<number> = new Set();
/** 搜索态下「展示用」折叠集合的空集单例（见 displayCollapsed*）：模块级常量，
 *  避免每次渲染重建新 Set/数组 —— 新引用会把 memo(SectionList) 的浅比较击穿，
 *  过滤态每键击都让整棵列表派生树重算（SectionList 只对 props 引用变化有感知）。 */
const EMPTY_COLLAPSED_GROUPS: ReadonlySet<number> = new Set();
const EMPTY_COLLAPSED_SITES: readonly string[] = [];

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

  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [quickRegrouping, setQuickRegrouping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  /** 已处理的挂起动作时间戳（即时消息 + session onChanged 双通道去重）。 */
  const handledActionsRef = useRef<Set<number>>(new Set());
  // 不订阅 currentWindowId：唯一的消费方 smartActivate 改为 store.getState() 实时读取，
  // 少一个订阅即少一类「窗口切换导致全树重渲染」。
  // 全窗口搜索数据源（设置开启且输入非空时，异步补充其他窗口标签；默认仅当前窗口）
  const otherTabs = useAllWindowTabs(settings.searchAllWindows, query);

  const isFiltering = query.trim().length > 0;
  // 搜索用标签集：开启全窗口搜索且输入中时并入其他窗口标签（其余场景恒等于当前窗口）
  const effectiveTabs = useMemo(
    () =>
      isFiltering && settings.searchAllWindows ? [...tabs, ...otherTabs] : (tabs as TabRecord[]),
    [tabs, otherTabs, isFiltering, settings.searchAllWindows]
  );
  // 命中「开发者禁缓存」规则的标签 id 集合（侧边栏 TabRow 角标用；空规则时返回空集，省去下游 has() 判空）
  const noCacheTabIds = useMemo(() => {
    const patterns = settings.noCacheEnabled ? settings.noCachePatterns : [];
    if (patterns.length === 0) return EMPTY_NO_CACHE_SET;
    const matched = new Set<number>();
    for (const tab of effectiveTabs) {
      const url = tab.url;
      if (!url) continue;
      if (patterns.some((pattern) => matchesNoCachePattern(url, pattern))) matched.add(tab.id);
    }
    return matched;
    // EMPTY_NO_CACHE_SET 是模块级常量，非响应式值，不进依赖数组。
  }, [settings.noCacheEnabled, settings.noCachePatterns, effectiveTabs]);

  // 常驻搜索：输入即过滤下方列表（fuzzysort 内核：标题 / URL / 拼音可选）
  const engine = useMemo(
    () =>
      new SearchEngine(
        effectiveTabs.map((tab) => ({
          id: tab.id,
          title: tab.title || t('tabs.untitled'),
          url: tab.url || '',
          active: tab.active
        })),
        { pinyin: settings.pinyinSearch }
      ),
    [effectiveTabs, t, settings.pinyinSearch]
  );
  /**
   * 拼音目标是异步补齐的（词典按需动态加载），补齐本身不改变任何 React 状态。
   * 没有这个信号，拼音命中会一直不出现：既不会在首次输入时自愈，也会在
   * 「标签事件 → 重建引擎」后把已有的拼音结果瞬间清空。
   *
   * 用递增 tick 而非布尔：engine 重建后 state 可能已是 true（旧引擎恒 true），
   * 新引擎异步补齐完成时 set(true) 被 React 丢弃（值未变），拼音命中照样不出现。
   * tick 每次 +1 保证触发重算。
   */
  const [pinyinTick, setPinyinTick] = useState(0);
  useEffect(() => {
    if (engine.pinyinReady) return;
    let cancelled = false;
    void engine
      .ensurePinyin()
      .then(() => {
        if (!cancelled) setPinyinTick((tick) => tick + 1);
      })
      // 词典加载失败（动态 import 网络/解析错误）：保持非拼音搜索可用，
      // 不产生 unhandled rejection。
      .catch((error: unknown) => {
        logDegraded('search', '拼音词典加载失败，本轮拼音搜索不可用', error);
      });
    return () => {
      cancelled = true;
    };
  }, [engine]);
  const searchHits = useMemo(
    () => engine.search(query, Math.max(effectiveTabs.length, 50)),
    // pinyinTick 是重算触发器：词典就绪后 engine 内部状态变了但引用未变，
    // lint 规则看不见它在回调里的用途，故显式豁免。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, query, effectiveTabs.length, pinyinTick]
  );
  const filteredTabs = useMemo(() => {
    if (!query.trim()) return effectiveTabs;
    const hitIds = new Set(searchHits.map((hit) => hit.tabId));
    return effectiveTabs.filter((tab) => hitIds.has(tab.id));
  }, [query, searchHits, effectiveTabs]);
  const selectedSearchTabId = searchHits[searchIndex]?.tabId;

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

  useEffect(() => {
    setSearchIndex(0);
  }, [query]);
  // 搜索期间标签被关闭使 searchHits 收缩时，选中索引必须钳制回界内：
  // 越界的 selectedSearchTabId 为 undefined，高亮消失且 Enter 无动作。
  useEffect(() => {
    setSearchIndex((current) =>
      searchHits.length === 0 ? 0 : Math.min(current, searchHits.length - 1)
    );
  }, [searchHits.length]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (searchHits.length === 0) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSearchIndex((current) => (current + delta + searchHits.length) % searchHits.length);
      return;
    }
    if (event.key === 'Enter') {
      const tabId = selectedSearchTabId;
      if (tabId === undefined) return;
      event.preventDefault();
      void smartActivate(tabId);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      searchInputRef.current?.blur();
    }
  };
  const activeTabId = tabs.find((tab) => tab.active)?.id;
  /**
   * 必须 memo 化：`useLocateActive` 把 clearQuery 列进了内部 useCallback 依赖，
   * 这里每渲染一个新箭头函数 → handleLocateActive → handlePendingAction 全部换新引用
   * → 键盘监听、runtime 消息监听、挂起动作监听每次渲染都解绑重绑（本文件大量重渲染）。
   * 副作用还包括：挂起队列监听每次订阅都会异步读一次 session，多个在途读取可能在
   * 队列清除前重复读到同一条动作，导致重复执行。
   */
  const clearQuery = useCallback(() => setQuery(''), [setQuery]);
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
   * 执行挂起动作（搜索域名 / 定位激活）。
   * 同一动作可能经「即时消息」与「session onChanged」双通道到达：按 at 时间戳去重，
   * 无 at 的旧数据（面板未开时写入、启动消费）直接执行。
   *
   * 引用必须稳定：内部经 locateActiveRef 调用定位（同键盘路径），不再依赖
   * handleLocateActive —— 此前 handlePendingAction 随激活标签变化重建，使
   * runtime 消息监听与 watchPendingActions 每次切标签都解绑重挂（挂起队列
   * 重挂还会异步重读一次 session）。
   */
  const handlePendingAction = useCallback(
    (action: PendingAction) => {
      if (action.at !== undefined) {
        const seen = handledActionsRef.current;
        if (seen.has(action.at)) return;
        seen.add(action.at);
        // 防膨胀：仅保留最近一小批。
        if (seen.size > 32) {
          const oldest = seen.values().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
      }
      if (action.type === 'search-domain' && typeof action.query === 'string') {
        setQuery(action.query);
        searchInputRef.current?.focus();
      } else if (action.type === 'locate-active') {
        locateActiveRef.current();
      } else if (action.type === 'focus-search') {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    },
    [setQuery]
  );

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
        void initializeData().catch(() => undefined);
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

  // ⌘J / Ctrl+J 定位激活标签；⌘K / Ctrl+K 打开搜索
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setShowPalette(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        locateActiveRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
    };
    // 单一协议入口：未经 MessageSchema 校验的消息已被 onMessage 丢弃，
    // 这里只按 type 分发。新增消息类型时在本 switch 补分支。
    const onMessage = (message: Message) => {
      switch (message.type) {
        // 挂起动作经 handlePendingAction 统一处理：即时消息与 session 挂起
        // 双通道按 at 去重，避免同一次快捷键触发被消费两次（表现为搜索框内容被全选两次）。
        case 'focus-search':
        case 'search-domain':
        case 'locate-active':
          handlePendingAction(message);
          return;
        case 'duplicate-reused':
          notify(i18n.t('duplicates.reused'));
          return;
        case 'auto-discarded':
          showDiscardUndoToast(message);
          return;
        case 'settings-synced':
          // 设置落盘通知（storage.onChanged 之外的兜底同步）。
          void useDataStore.getState().refreshSettings();
          return;
        default:
          // UI → SW 方向的消息由 SW 处理，UI 无需响应。
          return;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const offMessage = onRuntimeMessage(onMessage);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      offMessage();
    };
  }, [handlePendingAction, notify, showDiscardUndoToast]);

  // 自动休眠台账：面板打开时若有未撤销批次，提示可一键唤醒
  useEffect(() => {
    void autoDiscardRepository
      .read()
      .then((batch) => {
        if (batch && batch.tabIds.length > 0) showDiscardUndoToast(batch);
      })
      .catch(() => {});
  }, [showDiscardUndoToast]);

  // 面板未开时挂起的动作（搜索域名 / 定位激活）：打开面板后消费
  useEffect(() => watchPendingActions(handlePendingAction), [handlePendingAction]);

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

  /**
   * 未过滤态的分区基线。
   *
   * deriveSections 是全量分区计算（排序 + 站点聚合 + opener 树）。原先「自动分组
   * effect」与「展示用 allSections」各自调用一次，非搜索时两者入参完全相同 ——
   * 每次标签快照都白算一遍。这里算一次，两处共用。
   */
  const baseSections = useMemo(() => {
    // deriveSections 接收 translate（来自 useTranslation 的 t）：切换语言时 t 重新生成，
    // 分区标题随之重算。t 本身即为 memo 键（i18n.language 变化 → t 引用变化），
    // 无需再额外读 i18n.language —— 两者等价，保留一份避免双重触发。
    return deriveSections({
      tabs,
      groups,
      excludedTabIds: fixedExcludedTabIds,
      sortMode: settings.sortMode,
      groupMode: settings.groupMode,
      threshold: settings.aggregationThreshold,
      translate: t
    });
  }, [
    tabs,
    groups,
    fixedExcludedTabIds,
    settings.sortMode,
    settings.groupMode,
    settings.aggregationThreshold,
    t
  ]);

  // 自动原生分组（设置开启时）：把聚合结果落成浏览器 tabGroups。
  // 幂等：创建成功后标签获得 groupId，下一轮快照不再产出 plan。
  useEffect(() => {
    if (!settings.autoGroupNative || settings.groupMode === 'opener') return;
    const plans = planAutoGroups(baseSections);
    // syncAutoGroups 幂等（只为尚无 groupId 的标签建组），语言切换后分区标题
    // 随之重算是安全的，不会重复建组。
    if (plans.length > 0) void syncAutoGroups(plans);
  }, [baseSections, settings.autoGroupNative, settings.groupMode]);

  // 关闭自动分组时：解散本功能创建的组（标签回到未分组，记录清空）。
  useEffect(() => {
    if (settings.autoGroupNative) return;
    void disbandAutoGroups();
  }, [settings.autoGroupNative]);

  const allSections = useMemo(() => {
    // 非过滤态下 filteredTabs 与 tabs 等价，直接复用基线结果。
    if (!isFiltering) return baseSections;
    return deriveSections({
      tabs: filteredTabs,
      groups,
      excludedTabIds: fixedExcludedTabIds,
      sortMode: settings.sortMode,
      groupMode: settings.groupMode,
      threshold: settings.aggregationThreshold,
      translate: t
    });
  }, [
    isFiltering,
    baseSections,
    filteredTabs,
    groups,
    fixedExcludedTabIds,
    settings.sortMode,
    settings.groupMode,
    settings.aggregationThreshold,
    t
  ]);

  /** 浏览器原生固定标签单独提取，渲染在搜索栏正下方 */
  // memo 保持引用稳定：SectionList 是 memo 组件，新数组引用会击穿其浅比较。
  const pinnedSection = useMemo(() => allSections.find((s) => s.kind === 'pinned'), [allSections]);
  const restSections = useMemo(() => allSections.filter((s) => s.kind !== 'pinned'), [allSections]);
  // dnd-kit items 同理：每次渲染新建数组会让 SortableContext value 变化、子节点无效重渲染。
  const pinnedSortableIds = useMemo(
    () => pinnedSection?.tabs.map((tab) => tab.id) ?? [],
    [pinnedSection]
  );
  // 拖拽分发（排序/投放/建文件夹/固定）独立为 hook，handler 引用稳定。
  const { onDragEnd, handleReorder, handleMoveTab } = useTabDragHandlers();
  const duplicateIndex = useMemo(() => DuplicateIndex.build(tabs), [tabs]);
  const duplicateCounts = useMemo(() => duplicateIndex.counts(), [duplicateIndex]);

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

  const collapsedGroupIds = useMemo(
    () => new Set(groups.filter((group) => group.collapsed).map((group) => group.id)),
    [groups]
  );
  // 搜索时强制展开所有折叠分组/站点，确保命中标签可见。
  // 仅覆盖「展示用」折叠集合，不改动已存储的折叠偏好；清空搜索即原样还原。
  const displayCollapsedGroups = isFiltering ? EMPTY_COLLAPSED_GROUPS : collapsedGroupIds;
  const displayCollapsedSites: ReadonlySet<string> | readonly string[] = isFiltering
    ? EMPTY_COLLAPSED_SITES
    : collapsedSites;
  const collapsibleSections = useMemo(
    () => restSections.filter((section) => section.kind === 'native' || section.kind === 'site'),
    [restSections]
  );
  const allSectionsCollapsed =
    collapsibleSections.length > 0 &&
    collapsibleSections.every((section) =>
      section.kind === 'native'
        ? displayCollapsedGroups.has(section.groupId)
        : displayCollapsedSites.includes(section.siteKey)
    );
  const handleToggleAllSections = useCallback(() => {
    const shouldCollapse = !allSectionsCollapsed;
    for (const section of collapsibleSections) {
      if (section.kind === 'native') {
        void setGroupCollapsed(section.groupId, shouldCollapse);
      } else {
        void toggleSiteCollapsed(section.siteKey, shouldCollapse);
      }
    }
  }, [allSectionsCollapsed, collapsibleSections, setGroupCollapsed, toggleSiteCollapsed]);

  const handleCloseTab = useCallback(
    (tab: TabRecord) => {
      void closeWithUndo(useTabStore.getState().tabs, [tab.id]);
    },
    [closeWithUndo]
  );
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
          onKeyDown={handleSearchKeyDown}
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
            // 加载骨架：区分「同步中」与「真的没有标签」
            <LoadingSkeleton />
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
              searchActiveTabId={selectedSearchTabId}
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
          quickRegrouping={quickRegrouping}
          activeTabId={activeTabId}
          discardedCount={discardedCount}
          onToggleAllSections={handleToggleAllSections}
          onDiscardInactive={handleDiscardInactive}
          onWakeAll={handleWakeAll}
          onQuickRegroup={handleQuickRegroup}
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
        {!settings.onboarded && dataReady && (
          // 引导已完整讲过功能清单与固定空间概念（磁贴 vs 收藏夹），完成引导即
          // 同步收起三层引导（Tour / Tip Banner / 固定空间概念卡）中的后两层，
          // 避免"关完一层还有一层"（概念卡仍可从设置页「固定概念一览」随时查看）。
          <OnboardingTour
            onDone={() => {
              void tryUpdateSettings({ onboarded: true, tipSeen: true, conceptsSeen: true });
            }}
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
