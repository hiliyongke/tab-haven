import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { DuplicateIndex, KeeperPolicy } from '@/core/dup/DuplicateIndex';
import { deriveSections } from '@/core/site/Sections';
import type { TabRecord } from '@/core/tab-types';
import { SearchFocusMessageSchema } from '@/platform/messages';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { Icon, Icons } from '@/ui/common/Icon';
import { FixedArea } from '@/ui/fixed/FixedArea';
import { PinnedStrip } from '@/ui/fixed/PinnedStrip';
import { SearchOverlay } from '@/ui/search/SearchOverlay';
import { SectionList, splitPartnerIds } from '@/ui/tabs/SectionList';

export default function App() {
  const { t } = useTranslation();
  const tabs = useTabStore((state) => state.tabs);
  const groups = useTabStore((state) => state.groups);
  const activateTab = useTabStore((state) => state.activateTab);
  const closeTabs = useTabStore((state) => state.closeTabs);
  const toggleMute = useTabStore((state) => state.toggleMute);
  const togglePinned = useTabStore((state) => state.togglePinned);
  const setGroupCollapsed = useTabStore((state) => state.setGroupCollapsed);
  const createNewTab = useTabStore((state) => state.createNewTab);
  const startTabSync = useTabStore((state) => state.startTabSync);
  const initializeData = useDataStore((state) => state.initialize);
  const boundTabIds = useDataStore((state) => state.boundTabIds);
  const folders = useDataStore((state) => state.folders);

  const [collapsedSites, setCollapsedSites] = useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);

  // 同步服务：事件 → 快照 → store 订阅自动重渲染
  useEffect(() => {
    void initializeData();
    return startTabSync();
  }, [initializeData, startTabSync]);

  // ⌘K / Ctrl+K 打开搜索；background focus-search 命令转发
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    const onMessage = (message: unknown) => {
      if (SearchFocusMessageSchema.safeParse(message).success) setSearchOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

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

  const sections = useMemo(
    () => deriveSections({ tabs, groups, excludedTabIds: fixedExcludedTabIds }),
    [tabs, groups, fixedExcludedTabIds]
  );
  const duplicateCounts = useMemo(() => DuplicateIndex.build(tabs).counts(), [tabs]);
  const removableCount = useMemo(
    () => DuplicateIndex.build(tabs).removable(KeeperPolicy.default).length,
    [tabs]
  );

  const activeTabId = tabs.find((tab) => tab.active)?.id;
  const partners = useMemo(() => splitPartnerIds(tabs, activeTabId), [tabs, activeTabId]);
  const collapsedGroupIds = useMemo(
    () => new Set(groups.filter((group) => group.collapsed).map((group) => group.id)),
    [groups]
  );

  const handleCloseTab = (tab: TabRecord) => {
    void closeTabs([tab.id]);
  };
  const handleCloseSiteGroup = (_siteKey: string, groupTabs: readonly TabRecord[]) => {
    void closeTabs(groupTabs.map((tab) => tab.id));
  };

  return (
    <main className="app flex h-full flex-col">
      <PinnedStrip />
      <FixedArea />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <div className="flex-1 overflow-y-auto p-2">
        {tabs.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-gray-400">
            <p className="font-medium text-gray-500">{t('empty.title')}</p>
            <p>{t('empty.hint')}</p>
          </div>
        ) : (
          <SectionList
            sections={sections}
            collapsedGroups={collapsedGroupIds}
            collapsedSites={collapsedSites}
            duplicateCounts={duplicateCounts}
            activeTabId={activeTabId}
            splitPartners={partners}
            callbacks={{
              onActivate: (tabId) => void activateTab(tabId),
              onToggleMute: (tab) => void toggleMute(tab),
              onTogglePin: (tab) => void togglePinned(tab),
              onCloseTab: handleCloseTab,
              onToggleGroupCollapsed: (groupId, collapsed) =>
                void setGroupCollapsed(groupId, collapsed),
              onToggleSiteCollapsed: (siteKey, collapsed) => {
                setCollapsedSites((prev) => {
                  const next = new Set(prev);
                  if (collapsed) next.add(siteKey);
                  else next.delete(siteKey);
                  return next;
                });
              },
              onCloseSiteGroup: handleCloseSiteGroup
            }}
          />
        )}

        <div className="pt-1">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-gray-200 py-2 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-500"
            onClick={() => void createNewTab()}
          >
            <Icon d={Icons.plus} className="h-4 w-4" />
            <span>{t('tabs.newTab')}</span>
          </button>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-gray-200 px-3 py-1.5 text-xs text-gray-500">
        <span>
          {t('tabs.currentOpen')} <strong>{tabs.length}</strong> {t('tabs.tabCountUnit')}
        </span>
        <nav className="flex items-center gap-1" aria-label={t('footer.utilityLabel')}>
          <button
            type="button"
            className="rounded p-1 hover:bg-gray-100"
            title={t('footer.search')}
            onClick={() => setSearchOpen(true)}
          >
            <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 0 8 8" className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="relative rounded p-1 hover:bg-gray-100"
            title={
              removableCount > 0
                ? t('duplicates.cleanTooltip', { count: removableCount })
                : t('duplicates.none')
            }
            disabled={removableCount === 0}
            onClick={() => {
              const removable = DuplicateIndex.build(tabs).removable(KeeperPolicy.default);
              if (removable.length > 0) void closeTabs(removable.map((tab) => tab.id));
            }}
          >
            <Icon d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13h10l1-13" className="h-4 w-4" />
            {removableCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white">
                {removableCount}
              </span>
            )}
          </button>
        </nav>
      </footer>
    </main>
  );
}
