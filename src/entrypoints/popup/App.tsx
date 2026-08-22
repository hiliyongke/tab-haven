import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchEngine } from '@/core/search/SearchEngine';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { Favicon } from '@/ui/common/Favicon';
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
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initializeData();
    return startTabSync();
  }, [initializeData, startTabSync]);

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
        }))
      ),
    [tabs, t]
  );

  const hits = useMemo(() => engine.search(query, 20), [engine, query]);

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
    <main className="w-[420px] p-2">
      <SettingsSync />
      <input
        ref={inputRef}
        type="search"
        className="w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
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
                type="button"
                className={
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm' +
                  (index === selectedIndex ? ' bg-gray-100' : ' hover:bg-gray-50')
                }
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  void activateTab(hit.tabId);
                  window.close();
                }}
              >
                <Favicon src={tab.favIconUrl} title={tab.title || ''} size={16} />
                <span
                  className="min-w-0 flex-1 truncate"
                  dangerouslySetInnerHTML={{ __html: hit.titleMarkup }}
                />
              </button>
            );
          })
        )}
      </div>
    </main>
  );
}
