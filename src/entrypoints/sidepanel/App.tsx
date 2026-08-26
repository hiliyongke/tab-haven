import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { DuplicateIndex } from '@/core/dup/DuplicateIndex';
import { planAutoGroups, planRegroup } from '@/core/group/AutoGrouping';
import { SearchEngine } from '@/core/search/SearchEngine';
import { deriveSections } from '@/core/site/Sections';
import { canSafelyDiscardTab, NO_GROUP } from '@/core/tab-types';
import type { TabRecord } from '@/core/tab-types';
import {
  AutoDiscardedMessageSchema,
  DuplicateReusedMessageSchema,
  LocateActiveMessageSchema,
  PENDING_ACTIONS_KEY,
  SearchDomainMessageSchema,
  SearchFocusMessageSchema,
  SettingsSyncedMessageSchema
} from '@/platform/messages';
import {
  activateTabAcrossWindows,
  detectLanguage,
  reloadTabs
} from '@/platform/tabs';
import { autoDiscardRepository } from '@/platform/storage/repositories';
import {
  syncAutoGroups,
  disbandAutoGroups,
  regroupTempArea
} from '@/platform/group/AutoGroupSync';
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
import { FixedArea, LOCATE_TAB_EVENT } from '@/ui/fixed/FixedArea';
import { PinnedStrip } from '@/ui/fixed/PinnedStrip';
import { SearchBar } from '@/ui/search/SearchBar';
import { LOCATE_SECTION_EVENT, SectionList, splitPartnerIds } from '@/ui/tabs/SectionList';
import { SortablePinnedTile } from '@/ui/tabs/SortablePinnedTile';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { FooterToolbar } from '@/entrypoints/sidepanel/FooterToolbar';
import { EmptyTabs, LoadingSkeleton, NoSearchResults } from '@/entrypoints/sidepanel/ListStates';
import { useTabDragHandlers } from '@/entrypoints/sidepanel/useTabDragHandlers';
import { useAllWindowTabs } from '@/ui/common/useAllWindowTabs';

export default function App() {
  const { t, i18n } = useTranslation();
  const tabs = useTabStore((state) => state.tabs);
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
  const setLanguage = useTabStore((state) => state.setLanguage);
  const renameGroup = useTabStore((state) => state.renameGroup);
  const recolorGroup = useTabStore((state) => state.recolorGroup);
  const moveGroup = useTabStore((state) => state.moveGroup);
  const startTabSync = useTabStore((state) => state.startTabSync);
  const initializeData = useDataStore((state) => state.initialize);
  const updateSettings = useDataStore((state) => state.updateSettings);
  const dataReady = useDataStore((state) => state.ready);
  const boundTabIds = useDataStore((state) => state.boundTabIds);
  const folders = useDataStore((state) => state.folders);
  const settings = useDataStore((state) => state.settings);
  const collapsedSites = useDataStore((state) => state.collapsedSites);
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
  const locateRequestRef = useRef(0);
  /** 最近一次用户主动滚动时间戳：滚动中激活标签变化不触发自动跟随滚动（防"抢滚"）。 */
  const lastUserScrollRef = useRef(0);
  const markUserScroll = useCallback(() => {
    lastUserScrollRef.current = Date.now();
  }, []);
  /** 已处理的挂起动作时间戳（即时消息 + session onChanged 双通道去重）。 */
  const handledActionsRef = useRef<Set<number>>(new Set());
  const currentWindowId = useTabStore((state) => state.currentWindowId);

  // 全窗口搜索数据源（设置开启且输入非空时，异步补充其他窗口标签；默认仅当前窗口）
  const otherTabs = useAllWindowTabs(settings.searchAllWindows, query);

  const isFiltering = query.trim().length > 0;
  // 搜索用标签集：开启全窗口搜索且输入中时并入其他窗口标签（其余场景恒等于当前窗口）
  const effectiveTabs = useMemo(
    () =>
      isFiltering && settings.searchAllWindows
        ? [...tabs, ...otherTabs]
        : (tabs as TabRecord[]),
    [tabs, otherTabs, isFiltering, settings.searchAllWindows]
  );

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
  const searchHits = useMemo(
    () => engine.search(query, Math.max(effectiveTabs.length, 50)),
    [engine, query, effectiveTabs.length]
  );
  const filteredTabs = useMemo(() => {
    if (!query.trim()) return effectiveTabs;
    const hitIds = new Set(searchHits.map((hit) => hit.tabId));
    return effectiveTabs.filter((tab) => hitIds.has(tab.id));
  }, [query, searchHits, effectiveTabs]);
  const selectedSearchTabId = searchHits[searchIndex]?.tabId;

  /** 智能激活：目标标签在其他窗口时先聚焦窗口再激活（全窗口搜索用）。 */
  const smartActivate = useCallback(
    (tabId: number) => {
      const tab = effectiveTabs.find((candidate) => candidate.id === tabId);
      if (tab && tab.windowId !== currentWindowId) {
        return activateTabAcrossWindows({ id: tab.id, windowId: tab.windowId });
      }
      return activateTab(tabId);
    },
    [effectiveTabs, currentWindowId, activateTab]
  );

  useEffect(() => {
    setSearchIndex(0);
  }, [query]);

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
  const handleLocateActive = useCallback(() => {
    if (activeTabId === undefined) {
      notify(t('toast.activeTabNotFound'));
      return;
    }
    const requestId = ++locateRequestRef.current;
    if (query.trim()) setQuery('');
    const locateTarget = () => {
      const target = document.querySelector<HTMLElement>(
        `[data-tabhaven-tab-id="${activeTabId}"]`
      );
      if (!target) return false;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      // 高亮动画定义在 .row-item 上：滚动锚点是 li，视觉行是内部 .row-item。
      const row = target.querySelector<HTMLElement>('.row-item') ?? target;
      row.classList.remove('is-located');
      void row.offsetWidth;
      row.classList.add('is-located');
      window.setTimeout(() => row.classList.remove('is-located'), 1200);
      return true;
    };
    if (locateTarget()) return;
    window.dispatchEvent(new CustomEvent<number>(LOCATE_SECTION_EVENT, { detail: activeTabId }));
    window.dispatchEvent(new CustomEvent<number>(LOCATE_TAB_EVENT, { detail: activeTabId }));
    let attempts = 0;
    const retryLocate = () => {
      if (requestId !== locateRequestRef.current) return;
      window.dispatchEvent(new CustomEvent<number>(LOCATE_SECTION_EVENT, { detail: activeTabId }));
      window.dispatchEvent(new CustomEvent<number>(LOCATE_TAB_EVENT, { detail: activeTabId }));
      if (locateTarget()) return;
      attempts += 1;
      if (attempts < 12) window.setTimeout(retryLocate, 50);
    };
    window.setTimeout(retryLocate, 0);
  }, [activeTabId, notify, query, setQuery, t]);

  /**
   * 执行挂起动作（搜索域名 / 定位激活）。
   * 同一动作可能经「即时消息」与「session onChanged」双通道到达：按 at 时间戳去重，
   * 无 at 的旧数据（面板未开时写入、启动消费）直接执行。
   */
  const handlePendingAction = useCallback(
    (action: { type: string; query?: string; at?: number }) => {
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
        handleLocateActive();
      }
    },
    [handleLocateActive]
  );

  /** 自动休眠撤销提示：toast + 「全部唤醒」动作（唤醒后清台账）。 */
  const showDiscardUndoToast = useCallback(
    (batch: { tabIds: number[]; count: number }) => {
      notify(t('discard.autoDiscarded', { count: batch.count }), {
        label: t('discard.wakeAll'),
        run: async () => {
          const woken = (await reloadTabs(batch.tabIds)).length;
          await autoDiscardRepository.write(null);
          useUndoStore.getState().notify(t('discard.woken', { count: woken }));
        }
      });
    },
    [notify, t]
  );

  // 同步服务：事件 → 快照 → store 订阅自动重渲染
  useEffect(() => {
    // 初始化失败时 toast 并自动重试一次（dataStore 已回滚 initialized 守卫，允许重入），
    // 避免面板永久停在 Loading 骨架屏。
    void initializeData().catch(() => {
      notify(t('errors.dataLoadFailed'));
      setTimeout(() => {
        void initializeData().catch(() => {});
      }, 1000);
    });
    void loadUndo();
    void useSnapshotStore.getState().load();
    return startTabSync();
  }, [initializeData, loadUndo, startTabSync, notify, t]);

  // 快照联动：挂起转正 + 绑定维护（固定空间一致性，由入口层编排，
  // 避免 tabStore ↔ dataStore 相互依赖）。
  useEffect(() => {
    void reconcileWithTabs(tabs);
  }, [tabs, reconcileWithTabs]);

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
        handleLocateActive();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
    };
    const onMessage = (message: unknown) => {
      if (SearchFocusMessageSchema.safeParse(message).success) {
        searchInputRef.current?.focus();
        return;
      }
      if (DuplicateReusedMessageSchema.safeParse(message).success) {
        notify(t('duplicates.reused'));
        return;
      }
      const auto = AutoDiscardedMessageSchema.safeParse(message);
      if (auto.success) {
        showDiscardUndoToast(auto.data);
        return;
      }
      const searchDomain = SearchDomainMessageSchema.safeParse(message);
      if (searchDomain.success) {
        handlePendingAction(searchDomain.data);
        return;
      }
      const locateActive = LocateActiveMessageSchema.safeParse(message);
      if (locateActive.success) {
        handlePendingAction(locateActive.data);
        return;
      }
      // 设置落盘通知（storage.onChanged 之外的兜底同步）。
      if (SettingsSyncedMessageSchema.safeParse(message).success) {
        void useDataStore.getState().refreshSettings();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [handleLocateActive, handlePendingAction, notify, showDiscardUndoToast, t]);

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
  useEffect(() => {
    const sessionArea = browser.storage?.session;
    /** 消费并清除 session 队列：执行即清，杜绝历史动作随下次写入重放。 */
    const consume = (list: unknown[]) => {
      for (const action of list) {
        const search = SearchDomainMessageSchema.safeParse(action);
        if (search.success) {
          handlePendingAction(search.data);
          continue;
        }
        const locate = LocateActiveMessageSchema.safeParse(action);
        if (locate.success) handlePendingAction(locate.data);
      }
      void sessionArea?.remove(PENDING_ACTIONS_KEY).catch(() => {});
    };
    if (sessionArea) {
      void sessionArea
        .get(PENDING_ACTIONS_KEY)
        .then((record) => {
          const list = record[PENDING_ACTIONS_KEY];
          if (Array.isArray(list) && list.length > 0) consume(list);
        })
        .catch(() => {});
    }
    const onStorageChanged = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string
    ) => {
      if (areaName !== 'session' || !changes[PENDING_ACTIONS_KEY]) return;
      const list = changes[PENDING_ACTIONS_KEY]?.newValue;
      // 即时消息通道已按 at 去重，此处仅执行新动作并立即消费清除。
      if (Array.isArray(list) && list.length > 0) consume(list);
    };
    browser.storage?.onChanged?.addListener(onStorageChanged);
    return () => browser.storage?.onChanged?.removeListener(onStorageChanged);
  }, [handlePendingAction]);

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

  // 自动原生分组（设置开启时）：把聚合结果落成浏览器 tabGroups。
  // 幂等：创建成功后标签获得 groupId，下一轮快照不再产出 plan。
  useEffect(() => {
    if (!settings.autoGroupNative || settings.groupMode === 'opener') return;
    const sections = deriveSections({
      tabs,
      groups,
      excludedTabIds: fixedExcludedTabIds,
      sortMode: settings.sortMode,
      groupMode: settings.groupMode,
      threshold: settings.aggregationThreshold,
      translate: t
    });
    const plans = planAutoGroups(sections);
    if (plans.length > 0) void syncAutoGroups(plans);
  }, [
    tabs,
    groups,
    fixedExcludedTabIds,
    settings.autoGroupNative,
    settings.groupMode,
    settings.sortMode,
    settings.aggregationThreshold
  ]);

  // 关闭自动分组时：解散此前由本功能创建的组（标签回到未分组，记录清空）。
  useEffect(() => {
    if (settings.autoGroupNative) return;
    void disbandAutoGroups();
  }, [settings.autoGroupNative]);

  const allSections = useMemo(() => {
    // deriveSections 现接收 translate（来自 useTranslation 的 t）；切换语言时
    // t 重新生成、组件重渲染，分区标题随之重算。i18n.language 仍作为 memo 键触发重算。
    void i18n.language;
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
    filteredTabs,
    groups,
    fixedExcludedTabIds,
    settings.sortMode,
    settings.groupMode,
    settings.aggregationThreshold,
    i18n.language
  ]);

  /** 浏览器原生固定标签单独提取，渲染在搜索栏正下方 */
  // memo 保持引用稳定：SectionList 是 memo 组件，新数组引用会击穿其浅比较。
  const pinnedSection = useMemo(() => allSections.find((s) => s.kind === 'pinned'), [allSections]);
  const restSections = useMemo(() => allSections.filter((s) => s.kind !== 'pinned'), [allSections]);
  // 拖拽分发（排序/投放/建文件夹/固定）独立为 hook，handler 引用稳定。
  const { onDragEnd, handleReorder, handleMoveTab } = useTabDragHandlers(restSections);
  const duplicateIndex = useMemo(() => DuplicateIndex.build(tabs), [tabs]);
  const duplicateCounts = useMemo(() => duplicateIndex.counts(), [duplicateIndex]);

  const partners = useMemo(() => splitPartnerIds(tabs, activeTabId), [tabs, activeTabId]);

  // 与浏览器多选高亮同步（tabs.onHighlighted）。
  useEffect(() => {
    const listener = (info: { tabIds: number[] }) => setHighlighted(info.tabIds);
    browser.tabs.onHighlighted.addListener(listener);
    return () => browser.tabs.onHighlighted.removeListener(listener);
  }, [setHighlighted]);

  // 按语言分组时，异步探测每个未分组标签的语言。
  useEffect(() => {
    if (settings.groupMode !== 'language') return;
    let cancelled = false;
    const eligible = tabs.filter((tab) => !tab.pinned && tab.groupId === NO_GROUP && !tab.language);
    for (const tab of eligible) {
      void detectLanguage(tab.id).then((lang) => {
        if (!cancelled) setLanguage(tab.id, lang);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [settings.groupMode, tabs, setLanguage]);

  const collapsedGroupIds = useMemo(
    () => new Set(groups.filter((group) => group.collapsed).map((group) => group.id)),
    [groups]
  );
  const collapsibleSections = restSections.filter(
    (section) => section.kind === 'native' || section.kind === 'site'
  );
  const allSectionsCollapsed =
    collapsibleSections.length > 0 &&
    collapsibleSections.every((section) =>
      section.kind === 'native'
        ? collapsedGroupIds.has(section.groupId)
        : collapsedSites.includes(section.siteKey)
    );
  const handleToggleAllSections = () => {
    const shouldCollapse = !allSectionsCollapsed;
    for (const section of collapsibleSections) {
      if (section.kind === 'native') {
        void setGroupCollapsed(section.groupId, shouldCollapse);
      } else {
        void toggleSiteCollapsed(section.siteKey, shouldCollapse);
      }
    }
  };

  const handleCloseTab = useCallback(
    (tab: TabRecord) => {
      void closeWithUndo(useTabStore.getState().tabs, [tab.id]);
    },
    [closeWithUndo]
  );
  const handleDuplicateTab = useCallback(
    (tab: TabRecord) => {
      void duplicateTab(tab.id).then(() => notify(t('toast.duplicated')));
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
  const handleDiscardInactive = () => {
    void (async () => {
      const allInactive = useTabStore.getState().tabs.filter((tab) => !tab.active && !tab.discarded);
      const targets = allInactive.filter((tab) => !boundTabIds.includes(tab.id) && canSafelyDiscardTab(tab));
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
  };
  // 一键唤醒全部休眠标签（与批量休眠成对）。
  const handleWakeAll = useCallback(() => {
    const discardedIds = useTabStore
      .getState()
      .tabs.filter((tab) => tab.discarded)
      .map((tab) => tab.id);
    if (discardedIds.length === 0) return;
    void reloadTabs(discardedIds).then((woken) =>
      notify(t('discard.woken', { count: woken.length }))
    );
  }, [notify, t]);
  const discardedCount = tabs.filter((tab) => tab.discarded).length;
  // 原生标签组 → 固定文件夹（桥接反向）。
  const handleSaveGroupAsFolder = useCallback(
    (groupId: number) => {
      const name =
        useTabStore.getState().groups.find((g) => g.id === groupId)?.title || t('tabs.unnamedGroup');
      const groupTabs = useTabStore.getState().tabs.filter((tab) => tab.groupId === groupId);
      void createFolderFromNativeGroup(name, groupTabs).then(() => notify(t('toast.savedAsFolder')));
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
  const handleQuickRegroup = () => {
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
      .then((count) => notify(t('footer.quickRegroupDone', { count })))
      .catch(() => notify(t('errors.operationFailed')))
      .finally(() => setQuickRegrouping(false));
  };

  // SectionList 为 memo 组件：callbacks 必须保持引用稳定（仅语言与 store 函数变化时重建），
  // 否则每次渲染都会导致整个列表树重渲染。所有 handler 均从 store getState 读取最新数据。
  const sectionCallbacks = useMemo(
    () => ({
      onActivate: (tabId: number) => void smartActivate(tabId),
      onToggleMute: (tab: TabRecord) => void toggleMute(tab),
      onTogglePin: (tab: TabRecord) => void togglePinned(tab),
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
      togglePinned,
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

  // 命令面板动作集合（⌘P）：复用既有 handler。命令面板仅在展开时挂载，
  // 此处用普通对象即可，避免把不稳定的 handler 当作 useMemo 依赖触发告警。
  const paletteActions: PaletteActions = {
    onDiscardInactive: handleDiscardInactive,
    onWakeAll: handleWakeAll,
    onQuickRegroup: handleQuickRegroup,
    onLocateActive: handleLocateActive,
    onOpenHistory: () => setShowHistory(true),
    onOpenSettings: () => void browser.runtime.openOptionsPage(),
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
        .saveSpace()
        .then(() => notify(t('snapshots.saved')))
        .catch(() => notify(t('errors.operationFailed'))),
    onArchiveWindow: () =>
      void useSnapshotStore
        .getState()
        .archiveCurrentWindow()
        .then((count) => notify(t('snapshots.archived', { count })))
        .catch(() => notify(t('errors.operationFailed')))
  };

  return (
    <main className="app flex h-full flex-col">
      <DndRoot onDragEnd={onDragEnd}>
      <SettingsSync />
      {/* 一次性「能力发现」Tip（P0 可发现性）：仅首次展示，把藏得深的能力推到用户面前。 */}
      {!settings.tipSeen && (
        <div className="mx-1 mb-1 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2">
          <Icon d={Icons.sparkles} className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold text-accent-700">{t('tips.discoverTitle')}</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-accent-700/90">{t('tips.discoverBody')}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium text-accent-700 transition-base hover:bg-accent-100"
            onClick={() => void updateSettings({ tipSeen: true })}
          >
            {t('tips.gotIt')}
          </button>
        </div>
      )}
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
      {settings.showPinnedStrip && <PinnedStrip />}
      {/* 浏览器原生固定标签区 — 同样受 showPinnedStrip 控制，与顶部固定空间条联动隐藏，避免
          用户关闭开关后磁贴区仍残留造成"开关没作用"的困惑。pinnedSection 本身为空（用户没原生
          固定标签）时仍按需不渲染。 */}
      {settings.showPinnedStrip && pinnedSection && (
        <CategoryModule
          title={pinnedSection.title}
          count={pinnedSection.tabs.length}
          className={'shrink-0 is-pinned size-' + settings.pinnedStripSize}
        >
          <div className="section-body">
            <SortableContext
              items={pinnedSection.tabs.map((tab) => tab.id)}
              strategy={rectSortingStrategy}
            >
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
                    onUnpin={() => togglePinned(tab)}
                    onDuplicate={() => handleDuplicateTab(tab)}
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
            collapsedGroups={collapsedGroupIds}
            collapsedSites={collapsedSites}
            duplicateCounts={duplicateCounts}
            activeTabId={activeTabId}
            splitPartners={partners}
            reorderEnabled={settings.tabOrderSync}
            showUrl={settings.showUrl}
            autoScrollActive={
              settings.autoScrollActive && Date.now() - lastUserScrollRef.current > 800
            }
            closeOnMiddleClick={settings.closeOnMiddleClick}
            density={settings.density}
            rowActionsVisible={settings.rowActionsVisible}
            showSplitBadges={settings.showSplitBadges}
            highlightedIds={highlightedIds}
            searchActiveTabId={selectedSearchTabId}
            callbacks={sectionCallbacks}
          />
        )}
      </div>

      <div className="add-tab-bar">
        <button
          type="button"
          className="add-tab-btn"
          onClick={() => void createNewTab()}
        >
          <Icon d={Icons.plus} className="h-4 w-4" />
          <span>{t('tabs.newTab')}</span>
        </button>
      </div>

      <FooterToolbar
        tabCount={tabs.length}
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
        onOpenSettings={() => void browser.runtime.openOptionsPage()}
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
        <OnboardingTour onDone={() => void updateSettings({ onboarded: true })} />
      )}
      {showPalette && (
        <CommandPalette tabs={tabs} actions={paletteActions} onClose={() => setShowPalette(false)} />
      )}
      </DndRoot>
    </main>
  );
}
