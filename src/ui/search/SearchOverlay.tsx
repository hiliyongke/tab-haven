import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchEngine } from '@/core/search/SearchEngine';
import { useTabStore } from '@/stores/tabStore';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 搜索覆盖层（FR-D2.1）：模糊搜索 + 命中高亮 + 键盘导航。
 * 键盘协议：↑/↓ 选择、Enter 切换、Esc 关闭。
 */
export function SearchOverlay({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tabs = useTabStore((state) => state.tabs);
  const activateTab = useTabStore((state) => state.activateTab);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 索引：标签变化时重建（O(n) prepare，150 标签规模开销可忽略）
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

  const hits = useMemo(() => engine.search(query), [engine, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 键盘导航
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (hits.length === 0) return;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setSelectedIndex((current) => (current + delta + hits.length) % hits.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const hit = hits[selectedIndex];
        if (hit) {
          void activateTab(hit.tabId);
          onClose();
        }
      }
    },
    [hits, selectedIndex, activateTab, onClose]
  );

  // 选中项滚动进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/10 pt-12">
      <div
        className="w-[min(560px,90vw)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-label={t('search.title')}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 0 8 8" className="h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            type="search"
            className="flex-1 bg-transparent text-sm outline-none"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
          />
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-100"
            onClick={onClose}
            aria-label={t('search.close')}
          >
            <Icon d={Icons.close} className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {hits.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-gray-400">
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
                  data-selected={index === selectedIndex}
                  className={
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm' +
                    (index === selectedIndex ? ' bg-gray-100' : ' hover:bg-gray-50')
                  }
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    void activateTab(hit.tabId);
                    onClose();
                  }}
                >
                  <Favicon src={tab.favIconUrl} title={tab.title || ''} size={16} />
                  <span
                    className="min-w-0 flex-1 truncate"
                    dangerouslySetInnerHTML={{ __html: hit.titleMarkup }}
                  />
                  {tab.url && (
                    <span className="shrink-0 max-w-[200px] truncate text-xs text-gray-400">
                      {hit.urlMarkup ? (
                        <span dangerouslySetInnerHTML={{ __html: hit.urlMarkup }} />
                      ) : (
                        tab.url
                      )}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
