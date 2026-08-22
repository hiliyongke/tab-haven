import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { DuplicateIndex, KeeperPolicy } from '@/core/dup/DuplicateIndex';
import { planAutoGroups } from '@/core/group/AutoGrouping';
import { SearchEngine } from '@/core/search/SearchEngine';
import { deriveSections } from '@/core/site/Sections';
import { canSafelyDiscardTab, NO_GROUP } from '@/core/tab-types';
import type { TabRecord } from '@/core/tab-types';
import { DuplicateReusedMessageSchema, SearchFocusMessageSchema } from '@/platform/messages';
import { moveTab, computeReorderIndex, captureVisibleTab, detectLanguage } from '@/platform/tabs';
import { syncAutoGroups, disbandAutoGroups } from '@/platform/group/AutoGroupSync';
import { useDataStore } from '@/stores/dataStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { Icon, Icons } from '@/ui/common/Icon';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { StatusToast } from '@/ui/common/StatusToast';
import { FixedArea, LOCATE_TAB_EVENT } from '@/ui/fixed/FixedArea';
import { PinnedStrip } from '@/ui/fixed/PinnedStrip';
import { SelectionBar } from '@/ui/tabs/SelectionBar';
import { SearchBar } from '@/ui/search/SearchBar';
import { LOCATE_SECTION_EVENT, SectionList, splitPartnerIds } from '@/ui/tabs/SectionList';
import { PinnedTile } from '@/ui/tabs/PinnedTile';

export default function App() {
  const { t } = useTranslation();
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
  const previews = useTabStore((state) => state.previews);
  const highlightedIds = useTabStore((state) => state.highlightedIds);
  const setPreview = useTabStore((state) => state.setPreview);
  const prunePreviews = useTabStore((state) => state.prunePreviews);
  const setHighlighted = useTabStore((state) => state.setHighlighted);
  const setLanguage = useTabStore((state) => state.setLanguage);
  const createGroup = useTabStore((state) => state.createGroup);
  const renameGroup = useTabStore((state) => state.renameGroup);
  const recolorGroup = useTabStore((state) => state.recolorGroup);
  const removeGroup = useTabStore((state) => state.removeGroup);
  const moveGroup = useTabStore((state) => state.moveGroup);
  const highlightTabs = useTabStore((state) => state.highlightTabs);
  const currentWindowId = useTabStore((state) => state.currentWindowId);
  const startTabSync = useTabStore((state) => state.startTabSync);
  const initializeData = useDataStore((state) => state.initialize);
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

  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const locateRequestRef = useRef(0);

  // 常驻搜索：输入即过滤下方列表（fuzzysort 内核：标题 / URL / 拼音可选）
  const engine = useMemo(
    () =>
      new SearchEngine(
        tabs.map((tab) => ({
          id: tab.id,
          title: tab.title || t('tabs.untitled'),
          url: tab.url || '',
          active: tab.active
        })),
        { pinyin: settings.pinyinSearch }
      ),
    [tabs, t, settings.pinyinSearch]
  );
  const searchHits = useMemo(
    () => engine.search(query, Math.max(tabs.length, 50)),
    [engine, query, tabs.length]
  );
  const filteredTabs = useMemo(() => {
    if (!query.trim()) return tabs;
    const hitIds = new Set(searchHits.map((hit) => hit.tabId));
    return tabs.filter((tab) => hitIds.has(tab.id));
  }, [query, searchHits, tabs]);
  const isFiltering = query.trim().length > 0;
  const selectedSearchTabId = searchHits[searchIndex]?.tabId;

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
      void activateTab(tabId);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      searchInputRef.current?.blur();
    }
  };
  const selectionActive = useSelectionStore((state) => state.active);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const enterSelectionMode = useSelectionStore((state) => state.enterSelectionMode);
  const exitSelectionMode = useSelectionStore((state) => state.exitSelectionMode);
  const toggleSelect = useSelectionStore((state) => state.toggle);
  const selectRange = useSelectionStore((state) => state.selectRange);
  const selectAll = useSelectionStore((state) => state.selectAll);
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
      target.classList.remove('is-located');
      void target.offsetWidth;
      target.classList.add('is-located');
      window.setTimeout(() => target.classList.remove('is-located'), 1200);
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

  // 同步服务：事件 → 快照 → store 订阅自动重渲染
  useEffect(() => {
    void initializeData().catch(() => notify(t('errors.dataLoadFailed')));
    void loadUndo();
    return startTabSync();
  }, [initializeData, loadUndo, startTabSync, notify, t]);

  // 快照联动：挂起转正 + 绑定维护（固定空间一致性，由入口层编排，
  // 避免 tabStore ↔ dataStore 相互依赖）。
  useEffect(() => {
    void reconcileWithTabs(tabs);
    prunePreviews(new Set(tabs.map((tab) => tab.id)));
  }, [tabs, reconcileWithTabs, prunePreviews]);

  // ⌘K / Ctrl+K 打开搜索；Ctrl+A 全选（选择模式下）；Esc 退出选择模式
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      if (useSelectionStore.getState().active && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll(useTabStore.getState().tabs.map((tab) => tab.id));
        return;
      }
      if (event.key === 'Escape') {
        const selection = useSelectionStore.getState();
        if (selection.active) {
          exitSelectionMode();
        }
      }
    };
    const onMessage = (message: unknown) => {
      if (SearchFocusMessageSchema.safeParse(message).success) {
        searchInputRef.current?.focus();
        return;
      }
      if (DuplicateReusedMessageSchema.safeParse(message).success) {
        notify(t('duplicates.reused'));
      }
    };
    document.addEventListener('keydown', onKeyDown);
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [selectAll, exitSelectionMode, handleLocateActive, notify, t]);

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
      threshold: settings.aggregationThreshold
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

  const allSections = useMemo(
    () =>
      deriveSections({
        tabs: filteredTabs,
        groups,
        excludedTabIds: fixedExcludedTabIds,
        sortMode: settings.sortMode,
        groupMode: settings.groupMode,
        threshold: settings.aggregationThreshold
      }),
    [filteredTabs, groups, fixedExcludedTabIds, settings.sortMode, settings.groupMode, settings.aggregationThreshold]
  );

  /** 浏览器原生固定标签单独提取，渲染在搜索栏正下方 */
  const pinnedSection = allSections.find((s) => s.kind === 'pinned');
  const restSections = allSections.filter((s) => s.kind !== 'pinned');
  const duplicateCounts = useMemo(() => DuplicateIndex.build(tabs).counts(), [tabs]);
  // 保留策略随设置：固定标签是否豁免清理
  const keeperPolicy = useMemo(
    () => new KeeperPolicy({ pinnedExempt: settings.keepPinnedInCleanup }),
    [settings.keepPinnedInCleanup]
  );
  const removableCount = useMemo(
    () => DuplicateIndex.build(tabs).removable(keeperPolicy).length,
    [tabs, keeperPolicy]
  );

  const partners = useMemo(() => splitPartnerIds(tabs, activeTabId), [tabs, activeTabId]);

  // 标签预览：仅在用户悬停当前激活标签时按需截图，默认关闭且不持久化。
  const handlePreviewRequest = (tab: TabRecord) => {
    if (
      !settings.previewEnabled ||
      tab.id !== activeTabId ||
      tab.incognito ||
      previews.has(tab.id)
    ) {
      return;
    }
    void captureVisibleTab(currentWindowId ?? browser.windows.WINDOW_ID_CURRENT).then((url) => {
      if (url) setPreview(tab.id, url);
    });
  };

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

  const handleCloseTab = (tab: TabRecord) => {
    void closeWithUndo(tabs, [tab.id]);
  };
  const handleCloseSiteGroup = (_siteKey: string, groupTabs: readonly TabRecord[]) => {
    void closeWithUndo(tabs, groupTabs.map((tab) => tab.id));
  };
  const handleDuplicateTab = (tab: TabRecord) => {
    void duplicateTab(tab.id).then(() => notify(t('toast.duplicated')));
  };
  const handleDiscardTab = (tab: TabRecord) => {
    if (!canSafelyDiscardTab(tab)) {
      notify(t('toast.discardSkipped'));
      return;
    }
    void discardTab(tab.id).then(() => notify(t('toast.discarded')));
  };
  // 一键休眠全部非激活、未固定的标签（释放内存）。
  const handleDiscardInactive = () => {
    const allInactive = useTabStore.getState().tabs.filter((tab) => !tab.active && !tab.discarded);
    const targets = allInactive.filter(canSafelyDiscardTab);
    for (const tab of targets) void discardTab(tab.id);
    if (targets.length > 0) {
      notify(
        allInactive.length === targets.length
          ? t('toast.discardedMany', { count: targets.length })
          : t('toast.discardedManySkipped', { count: targets.length, skipped: allInactive.length - targets.length })
      );
    } else if (allInactive.length > 0) {
      notify(t('toast.discardSkippedMany', { count: allInactive.length }));
    }
  };
  // 原生标签组 → 固定文件夹（桥接反向）。
  const handleSaveGroupAsFolder = (groupId: number) => {
    const name = groups.find((g) => g.id === groupId)?.title || t('tabs.unnamedGroup');
    const groupTabs = useTabStore.getState().tabs.filter((tab) => tab.groupId === groupId);
    void createFolderFromNativeGroup(name, groupTabs).then(() => notify(t('toast.savedAsFolder')));
  };

  // 新建原生组：优先把选中标签成组，否则将当前未分组标签全部成组。
  const handleCreateGroup = (tabIds?: readonly number[]) => {
    const members =
      tabIds && tabIds.length > 0
        ? [...tabIds]
        : useTabStore
            .getState()
            .tabs.filter((tab) => !tab.pinned && tab.groupId === NO_GROUP)
            .map((tab) => tab.id);
    if (members.length === 0) return;
    void createGroup(t('groups.newGroup'), undefined, members).then(() =>
      notify(t('toast.groupCreated'))
    );
  };
  const handleRenameGroup = (groupId: number, title: string) => void renameGroup(groupId, title);
  const handleRecolorGroup = (groupId: number, color: string) => void recolorGroup(groupId, color);
  const handleRemoveGroup = (groupId: number) =>
    void removeGroup(groupId).then(() => notify(t('toast.groupRemoved')));
  const handleMoveGroup = (groupId: number, index: number) => void moveGroup(groupId, index);
  const handleHighlightSelected = () => void highlightTabs([...selectedIds]);

  // 拖拽重排：用当前全部标签计算目标原生索引并写回浏览器。
  const handleReorder = (sourceId: number, targetId: number, placeAfter: boolean) => {
    const allTabs = useTabStore.getState().tabs;
    const index = computeReorderIndex({ tabs: allTabs, sourceId, targetId, placeAfter });
    if (index >= 0) void moveTab(sourceId, index);
  };

  // 键盘重排（Alt+↑/↓）：把标签向相邻展示位置移动。
  const handleMoveTab = (tabId: number, direction: -1 | 1) => {
    if (!settings.tabOrderSync) return;
    const allTabs = useTabStore.getState().tabs;
    const idx = allTabs.findIndex((tab) => tab.id === tabId);
    if (idx < 0) return;
    const target = allTabs[idx + direction];
    if (!target) return;
    handleReorder(tabId, target.id, direction > 0);
  };

  return (
    <main className="app flex h-full flex-col">
      <SettingsSync />
      <SearchBar
        query={query}
        onChange={setQuery}
        inputRef={searchInputRef}
        onKeyDown={handleSearchKeyDown}
      />
      {settings.showPinnedStrip && <PinnedStrip />}
      {/* 浏览器原生固定标签 — 始终在搜索栏下方、标签列表上方 */}
      {pinnedSection && (
        <section className="section-card shrink-0">
          <div className="section-head">
            <span className="section-title">{pinnedSection.title}</span>
            <span className="section-count">{pinnedSection.tabs.length}</span>
          </div>
          <div className="section-body">
            <div className="pinned-grid">
              {pinnedSection.tabs.map((tab) => (
                <PinnedTile
                  key={tab.id}
                  tab={tab}
                  onActivate={activateTab}
                  onTogglePin={togglePinned}
                  onClose={handleCloseTab}
                  onDuplicate={handleDuplicateTab}
                />
              ))}
            </div>
          </div>
        </section>
      )}
      <FixedArea />
      <StatusToast />
      <div className="flex-1 overflow-y-auto px-1 py-0.5">
        {!dataReady ? (
          // 加载骨架：区分「同步中」与「真的没有标签」
          <div className="flex flex-col gap-1 px-1 py-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2 px-1.5 py-[7px]">
                <span className="skeleton h-4 w-4 shrink-0" />
                <span className="skeleton h-3 flex-1" />
                <span className="skeleton h-3 w-8" />
              </div>
            ))}
          </div>
        ) : tabs.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <Icon d={Icons.plus} className="h-4.5 w-4.5" />
            </span>
            <p className="text-xs font-medium text-gray-600">{t('empty.title')}</p>
            <p className="max-w-[200px] text-2xs text-gray-500">{t('empty.hint')}</p>
          </div>
        ) : isFiltering && filteredTabs.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <Icon d={Icons.search} className="h-4.5 w-4.5" />
            </span>
            <p className="text-xs font-medium text-gray-600">{t('search.noResults')}</p>
            <button
              type="button"
              className="rounded px-2 py-1 text-2xs text-accent-600 transition-base hover:bg-accent-50"
              onClick={() => setQuery('')}
            >
              {t('search.clear')}
            </button>
          </div>
        ) : (
          <SectionList
            sections={restSections}
            collapsedGroups={collapsedGroupIds}
            collapsedSites={collapsedSites}
            duplicateCounts={duplicateCounts}
            activeTabId={activeTabId}
            splitPartners={partners}
            selectionMode={selectionActive}
            selectedIds={selectedIds}
            reorderEnabled={settings.tabOrderSync}
            showUrl={settings.showUrl}
            autoScrollActive={settings.autoScrollActive}
            closeOnMiddleClick={settings.closeOnMiddleClick}
            density={settings.density}
            rowActionsVisible={settings.rowActionsVisible}
            showSplitBadges={settings.showSplitBadges}
            previews={previews}
            highlightedIds={highlightedIds}
            searchActiveTabId={selectedSearchTabId}
            callbacks={{
              onActivate: (tabId) => void activateTab(tabId),
              onToggleSelect: (tabId) => {
                if (selectionActive) toggleSelect(tabId);
              },
              onRangeSelect: (tabId) => {
                selectRange(tabId, tabs.map((tab) => tab.id));
              },
              onToggleMute: (tab) => void toggleMute(tab),
              onTogglePin: (tab) => void togglePinned(tab),
              onCloseTab: handleCloseTab,
              onDuplicate: handleDuplicateTab,
              onDiscard: handleDiscardTab,
              onRequestPreview: handlePreviewRequest,
              onSaveGroupAsFolder: handleSaveGroupAsFolder,
              onGroupCreate: handleCreateGroup,
              onGroupRename: handleRenameGroup,
              onGroupRecolor: handleRecolorGroup,
              onGroupRemove: handleRemoveGroup,
              onGroupMove: handleMoveGroup,
              onHighlightSelected: handleHighlightSelected,
              onToggleGroupCollapsed: (groupId, collapsed) =>
                void setGroupCollapsed(groupId, collapsed),
              onToggleSiteCollapsed: (siteKey, collapsed) => {
                void toggleSiteCollapsed(siteKey, collapsed);
              },
              onCloseSiteGroup: handleCloseSiteGroup,
              onReorder: handleReorder,
              onMoveTab: handleMoveTab
            }}
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

      <SelectionBar tabs={tabs} />
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-gray-200 px-2.5 py-0.5 text-2xs text-gray-500">
        <span>
          {t('tabs.currentOpen')} <strong>{tabs.length}</strong> {t('tabs.tabCountUnit')}
        </span>
        <nav className="flex items-center gap-1" aria-label={t('footer.utilityLabel')}>
          <button
            type="button"
            className="rounded p-1 transition-base hover:bg-gray-100 disabled:cursor-default disabled:opacity-35"
            title={t(allSectionsCollapsed ? 'footer.expandAll' : 'footer.collapseAll')}
            aria-label={t(allSectionsCollapsed ? 'footer.expandAll' : 'footer.collapseAll')}
            disabled={collapsibleSections.length === 0}
            onClick={handleToggleAllSections}
          >
            <Icon d={allSectionsCollapsed ? Icons.expandAll : Icons.collapseAll} className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={
              'rounded p-1 transition-base hover:bg-gray-100' + (selectionActive ? ' bg-gray-100 text-accent-600' : '')
            }
            title={selectionActive ? t('selection.exitMode') : t('selection.enterMode')}
            aria-label={selectionActive ? t('selection.exitMode') : t('selection.enterMode')}
            onClick={() => {
              if (selectionActive) exitSelectionMode();
              else enterSelectionMode();
            }}
          >
            <Icon d={Icons.list} className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={
              'relative rounded p-1 transition-base hover:bg-gray-100' +
              (removableCount === 0 ? ' cursor-default opacity-40' : '')
            }
            title={
              removableCount > 0
                ? t('duplicates.cleanTooltip', { count: removableCount })
                : t('duplicates.none')
            }
            aria-label={t('footer.cleanDuplicates')}
            // aria-disabled 而非 disabled：保留 title 提示「为什么不可点」
            aria-disabled={removableCount === 0}
            onClick={() => {
              if (removableCount === 0) return;
              const removable = DuplicateIndex.build(tabs).removable(keeperPolicy);
              if (removable.length > 0) void closeWithUndo(tabs, removable.map((tab) => tab.id));
            }}
          >
            <Icon d={Icons.trash} className="h-4 w-4" />
            {removableCount > 0 && (
              <span className="count-badge absolute -right-0.5 -top-0.5" aria-hidden="true">
                {removableCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className="rounded p-1 transition-base hover:bg-gray-100"
            title={t('discard.allInactive')}
            aria-label={t('discard.allInactive')}
            onClick={handleDiscardInactive}
          >
            <Icon d={Icons.snowflake} className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 transition-base hover:bg-gray-100"
            title={t('groups.newGroup')}
            aria-label={t('groups.newGroup')}
            onClick={() => handleCreateGroup()}
          >
            <Icon d={Icons.layers} className="h-4 w-4" />
          </button>
          {selectionActive && (
            <button
              type="button"
              className="rounded p-1 transition-base hover:bg-gray-100"
              title={t('tabs.highlight')}
              aria-label={t('tabs.highlight')}
              onClick={handleHighlightSelected}
            >
              <Icon d={Icons.star} className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className="rounded p-1 transition-base hover:bg-gray-100 disabled:cursor-default disabled:opacity-35"
            title={t('tabs.locateActive')}
            aria-label={t('tabs.locateActive')}
            disabled={activeTabId === undefined}
            onClick={handleLocateActive}
          >
            <Icon d={Icons.locate} className="h-4 w-4" />
          </button>
          <span className="ml-1 flex items-center border-l border-gray-200 pl-1">
            <button
              type="button"
              className="rounded p-1.5 text-gray-600 transition-base hover:bg-gray-100 hover:text-accent-600"
              title={t('settings.title')}
              aria-label={t('settings.title')}
              onClick={() => void browser.runtime.openOptionsPage()}
            >
              <Icon d={Icons.settings} className="h-4 w-4" />
            </button>
          </span>
        </nav>
      </footer>
    </main>
  );
}
