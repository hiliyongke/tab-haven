import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { SearchEngine } from '@/core/search/SearchEngine';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { SettingsSync } from '@/ui/common/SettingsSync';

/**
 * 快速切换器（降级形态 FR-D10.1 / popup 入口）：
 * 搜索当前窗口标签并切换；聚焦即搜，Esc/失焦关闭。
 */
export default function App() {
  const { t } = useTranslation();
  const tabs = useTabStore((state) => state.tabs);
  const activateTab = useTabStore((state) => state.activateTab);
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

  const hits = useMemo(() => engine.search(query, 20), [engine, query]);

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
      if (hit) void activateTab(hit.tabId);
      window.close();
    } else if (event.key === 'Escape') {
      window.close();
    }
  };

  return (
    <main className="w-[420px] max-w-[calc(100vw-8px)] p-2">
      <SettingsSync />
      <input
        ref={inputRef}
        type="search"
        className="w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-accent-500"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelectedIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="mt-1 max-h-[360px] overflow-y-auto">
        {hits.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-gray-400">
            {query ? t('search.noResults') : t('search.typeHint')}
          </p>
        ) : (
          hits.map((hit, index) => {
            const tab = tabs.find((candidate) => candidate.id === hit.tabId);
            if (!tab) return null;
            return (
              <button
                key={hit.tabId}
                id={`popup-hit-${index}`}
                type="button"
                className={
                  'flex w-full items-center gap-2 rounded border-l-2 px-2 py-1.5 text-left text-sm' +
                  (index === selectedIndex
                    ? ' border-accent-500 bg-accent-50'
                    : ' border-transparent hover:bg-gray-50')
                }
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  void activateTab(hit.tabId);
                  window.close();
                }}
              >
                <Favicon src={tab.favIconUrl} title={tab.title || ''} size={16} />
                <span className="min-w-0 flex-1 truncate">
                  {hit.titleSegments.map((segment, index) =>
                    segment.hit ? (
                      <b key={index} className="bg-warn-200">
                        {segment.text}
                      </b>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    )
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
      <footer className="mt-2 flex justify-end border-t border-gray-200 pt-2">
        <button
          type="button"
          className="rounded p-1.5 text-gray-600 transition-base hover:bg-gray-100 hover:text-accent-600"
          title={t('settings.title')}
          aria-label={t('settings.title')}
          onClick={() => {
            void browser.runtime.openOptionsPage();
            window.close();
          }}
        >
          <Icon d={Icons.settings} className="h-4 w-4" />
        </button>
      </footer>
    </main>
  );
}
