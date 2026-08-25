import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { SearchEngine } from '@/core/search/SearchEngine';
import type { TabRecord } from '@/core/tab-types';
import { activateTabAcrossWindows } from '@/platform/tabs';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { EmptyState } from '@/ui/common/EmptyState';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { IconButton } from '@/ui/common/IconButton';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { TextField } from '@/ui/common/TextField';
import { useAllWindowTabs } from '@/ui/common/useAllWindowTabs';

/**
 * 快速切换器（降级形态 FR-D10.1 / popup 入口）：
 * 搜索当前窗口标签并切换；聚焦即搜，Esc/失焦关闭。
 */
export default function App() {
  const { t } = useTranslation();
  const tabs = useTabStore((state) => state.tabs);
  const startTabSync = useTabStore((state) => state.startTabSync);
  const initializeData = useDataStore((state) => state.initialize);
  const reconcileWithTabs = useDataStore((state) => state.reconcileWithTabs);
  const settings = useDataStore((state) => state.settings);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initializeData();
    return startTabSync();
  }, [initializeData, startTabSync]);

  // 快照联动：挂起转正 + 绑定维护（固定空间一致性）。
  useEffect(() => {
    void reconcileWithTabs(tabs);
  }, [tabs, reconcileWithTabs]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 全窗口搜索：设置开启且输入非空时并入其他窗口标签（与侧边栏行为一致，共用 hook）
  const otherTabs = useAllWindowTabs(settings.searchAllWindows, query);

  const effectiveTabs = useMemo(
    () =>
      query.trim() && settings.searchAllWindows ? [...tabs, ...otherTabs] : (tabs as TabRecord[]),
    [tabs, otherTabs, query, settings.searchAllWindows]
  );

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

  const hits = useMemo(() => engine.search(query, 20), [engine, query]);

  /** 智能激活：目标标签在其他窗口时先聚焦窗口再激活。 */
  const smartActivate = (tabId: number) => {
    const tab = effectiveTabs.find((candidate) => candidate.id === tabId);
    const currentWindowId = useTabStore.getState().currentWindowId;
    if (tab && tab.windowId !== currentWindowId) {
      return activateTabAcrossWindows({ id: tab.id, windowId: tab.windowId });
    }
    return useTabStore.getState().activateTab(tabId);
  };

  useEffect(() => {
    document
      .getElementById(`popup-hit-${selectedIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, hits.length]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (hits.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((current) => (current + delta + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) void smartActivate(hit.tabId);
      window.close();
    } else if (event.key === 'Escape') {
      window.close();
    }
  };

  return (
    <main className="w-[420px] max-w-[calc(100vw-8px)] p-2">
      <SettingsSync />
      <TextField
        type="search"
        size="lg"
        inputRef={inputRef}
        className="w-full"
        placeholder={t('search.placeholder')}
        ariaLabel={t('search.placeholder')}
        inputProps={{
          role: 'combobox',
          'aria-expanded': hits.length > 0,
          'aria-controls': 'popup-hits',
          'aria-activedescendant': hits.length > 0 ? `popup-hit-${selectedIndex}` : undefined
        }}
        value={query}
        onChange={(value) => {
          setQuery(value);
          setSelectedIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {/* 命中数对读屏播报（<output> 原生隐含 role=status） */}
      <output className="sr-only" aria-live="polite">
        {query.trim() ? t('search.hits', { count: hits.length }) : ''}
      </output>
      <div id="popup-hits" className="mt-1 max-h-[360px] overflow-y-auto">
        {hits.length === 0 ? (
          <EmptyState
            icon={<Icon d={Icons.search} className="h-4.5 w-4.5" />}
            title={query ? t('search.noResults') : t('search.typeHint')}
          />
        ) : (
          hits.map((hit, index) => {
            const tab = tabs.find((candidate) => candidate.id === hit.tabId);
            if (!tab) return null;
            return (
              <button
                key={hit.tabId}
                id={`popup-hit-${index}`}
                type="button"
                tabIndex={-1}
                className={
                  'flex w-full cursor-pointer items-center gap-2 rounded border-l-2 px-2 py-1.5 text-left text-sm' +
                  (index === selectedIndex
                    ? ' border-accent-500 bg-accent-50'
                    : ' border-transparent hover:bg-gray-50')
                }
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  void smartActivate(hit.tabId);
                  window.close();
                }}
              >
                <Favicon src={tab.favIconUrl} title={tab.title || ''} size={16} />
                <span className="min-w-0 flex-1 truncate">
                  {hit.titleSegments.map((segment, segmentIndex) =>
                    segment.hit ? (
                      <b key={segmentIndex} className="bg-warn-200">
                        {segment.text}
                      </b>
                    ) : (
                      <span key={segmentIndex}>{segment.text}</span>
                    )
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
      <footer className="mt-2 flex justify-end border-t border-gray-200 pt-2">
        <IconButton
          icon={Icons.settings}
          title={t('settings.title')}
          box="md"
          tone="accent"
          onClick={() => {
            void browser.runtime.openOptionsPage();
            window.close();
          }}
        />
      </footer>
    </main>
  );
}
