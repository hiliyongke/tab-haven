import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openOptionsPage } from '@/platform/navigation';
import { SearchEngine } from '@/core/search/SearchEngine';
import type { TabRecord } from '@/core/tab-types';
import { activateTabAcrossWindows } from '@/platform/tabs';
import { logDegraded } from '@/platform/diagnostics';
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
  const tabSyncReady = useTabStore((state) => state.tabSyncReady);
  const startTabSync = useTabStore((state) => state.startTabSync);
  const initializeData = useDataStore((state) => state.initialize);
  const reconcileWithTabs = useDataStore((state) => state.reconcileWithTabs);
  const dataReady = useDataStore((state) => state.ready);
  const settings = useDataStore((state) => state.settings);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 初始化失败不能成为 unhandled rejection；popup 无 toast 通道且失焦即销毁，
    // 侧边栏的「toast + 1s 重试」在此无意义，收口到诊断日志（数据层已回滚守卫）。
    void initializeData().catch((error: unknown) => {
      logDegraded('popup', '数据初始化失败', error);
    });
    return startTabSync();
  }, [initializeData, startTabSync]);

  // 快照联动：挂起转正 + 绑定维护（固定空间一致性）。
  // dataReady + tabSyncReady 双守卫同侧边栏：folders 未加载、首帧标签快照未回
  // 时的空状态跑绑定协调会把磁盘绑定整表清空。
  useEffect(() => {
    if (!dataReady || !tabSyncReady) return;
    void reconcileWithTabs(tabs);
  }, [tabs, reconcileWithTabs, dataReady, tabSyncReady]);

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

  // 拼音词典按需动态加载：就绪后必须重算一次命中，否则首次输入的拼音查询
  // 永远等不到结果（补齐拼音不改变任何 React 状态，本信号是唯一的重算入口）。
  const [pinyinReady, setPinyinReady] = useState(() => engine.pinyinReady);
  useEffect(() => {
    if (engine.pinyinReady) {
      setPinyinReady(true);
      return;
    }
    let cancelled = false;
    void engine
      .ensurePinyin()
      .then(() => {
        if (!cancelled) setPinyinReady(true);
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

  const hits = useMemo(
    () => engine.search(query, 20),
    // pinyinReady 是重算触发器：词典就绪后 engine 内部状态变了但引用未变，
    // lint 规则看不见它在回调里的用途，故显式豁免。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, query, pinyinReady]
  );

  /**
   * 命中项 → 标签记录的查找表。
   *
   * 数据源必须与 SearchEngine 的输入（effectiveTabs）严格一致：
   * 此前渲染时用 `tabs`（仅当前窗口）查找，开启「全窗口搜索」后，其他窗口的
   * 命中查不到就被 `return null` 静默丢弃 —— 搜索结果凭空少一截。
   * 用 Map 而非逐行 find，避免 20 条命中产生 O(n²) 查找。
   */
  const tabById = useMemo(
    () => new Map(effectiveTabs.map((tab) => [tab.id, tab])),
    [effectiveTabs]
  );
  /** 可渲染的命中：与 hits 恒等（数据源已对齐），保留过滤作为防御，
   *  避免将来任一处数据源改动时再次出现「播报数 ≠ 渲染行数」。 */
  const renderableHits = useMemo(
    () => hits.filter((hit) => tabById.has(hit.tabId)),
    [hits, tabById]
  );

  /** 智能激活：目标标签在其他窗口时先聚焦窗口再激活。 */
  const smartActivate = (tabId: number) => {
    const tab = effectiveTabs.find((candidate) => candidate.id === tabId);
    const currentWindowId = useTabStore.getState().currentWindowId;
    if (tab && tab.windowId !== currentWindowId) {
      return activateTabAcrossWindows({ id: tab.id, windowId: tab.windowId });
    }
    return useTabStore.getState().activateTab(tabId);
  };

  /**
   * 激活并关闭 popup：必须等激活链路完成再 close。
   * 跨窗口激活是「await 聚焦窗口 → 再激活标签」，window.close() 若同步销毁
   * popup 上下文，await 之后的 tabs.update 大概率不再执行 —— 表现为
   * 「窗口聚焦了但标签没切」。
   */
  const activateAndClose = (tabId: number) => {
    void smartActivate(tabId).finally(() => window.close());
  };

  useEffect(() => {
    document.getElementById(`popup-hit-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, renderableHits.length]);

  // 结果集收缩时钳制选中索引：标签实时变化（关闭/离开当前窗口）会让列表变短，
  // 越界的选中行不复存在 —— aria-activedescendant 指向空项、Enter 无动作。
  useEffect(() => {
    setSelectedIndex((current) =>
      renderableHits.length === 0 ? 0 : Math.min(current, renderableHits.length - 1)
    );
  }, [renderableHits.length]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (renderableHits.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex(
        (current) => (current + delta + renderableHits.length) % renderableHits.length
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = renderableHits[selectedIndex];
      if (hit) activateAndClose(hit.tabId);
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
          'aria-expanded': renderableHits.length > 0,
          'aria-controls': 'popup-hits',
          'aria-activedescendant':
            renderableHits.length > 0 ? `popup-hit-${selectedIndex}` : undefined
        }}
        value={query}
        onChange={(value) => {
          setQuery(value);
          setSelectedIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {/* 命中数对读屏播报（<output> 原生隐含 role=status）。
          播报 renderableHits 而非 hits：必须与下方实际渲染的行数一致，
          否则读屏用户听到的数量与实际可选项不符。 */}
      <output className="sr-only" aria-live="polite">
        {query.trim() ? t('search.hits', { count: renderableHits.length }) : ''}
      </output>
      <div id="popup-hits" className="mt-1 max-h-[360px] overflow-y-auto">
        {renderableHits.length === 0 ? (
          <EmptyState
            icon={<Icon d={Icons.search} className="h-4.5 w-4.5" />}
            title={query ? t('search.noResults') : t('search.typeHint')}
          />
        ) : (
          renderableHits.map((hit, index) => {
            const tab = tabById.get(hit.tabId);
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
                    ? ' border-accent-500 bg-accent-50 font-semibold'
                    : ' border-transparent hover:bg-gray-50')
                }
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => activateAndClose(hit.tabId)}
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
      {/* 键盘提示：↑↓/Enter/Esc 全部可用但此前不可发现（P2-4）；弱化呈现，不与结果列表抢注意力 */}
      <footer className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
        <span className="text-2xs text-gray-400">{t('popup.keyboardHint')}</span>
        <IconButton
          icon={Icons.settings}
          title={t('settings.title')}
          box="md"
          tone="accent"
          onClick={() => {
            openOptionsPage();
            window.close();
          }}
        />
      </footer>
    </main>
  );
}
