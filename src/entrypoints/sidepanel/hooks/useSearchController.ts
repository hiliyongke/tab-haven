import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchEngine } from '@/core/search/SearchEngine';
import { matchesNoCachePattern } from '@/platform/nocache/noCacheRules';
import { logDegraded } from '@/platform/diagnostics';
import type { TabRecord } from '@/core/tab-types';
import { useAllWindowTabs } from '@/ui/common/useAllWindowTabs';

/**
 * 常驻搜索：查询状态、模糊搜索引擎、命中/过滤、键盘导航、以及禁缓存角标集。
 *
 * 从 `App.tsx` 抽出（原为单文件内约 110 行、跨 8 个 hook 的一团状态）。这块逻辑有
 * 三个**不显眼但已知踩过坑**的点，集中后才有可能被回归测试守住：
 *
 * 1. **拼音就绪信号用递增 tick 而非布尔**：引擎重建后 state 可能已是 true（旧引擎恒 true），
 *    新引擎异步补齐完成时 `set(true)` 会被 React 丢弃（值未变），拼音命中照样不出现。
 * 2. **选中索引必须钳制回界内**：搜索期间标签被关闭会让 searchHits 收缩，越界的
 *    `selectedSearchTabId` 为 undefined，表现为高亮消失且 Enter 无动作。
 * 3. **空 `Set` 必须是模块级常量**：它挂在 `noCacheTabIds` 的依赖链上，
 *    每次渲染新建引用会把下游 memo(SectionList) 的浅比较击穿。
 */

/**
 * 禁缓存规则未启用时返回的空 Set 单例。
 * 必须是模块级常量：useMemo 的空依赖不保证引用稳定，而本值是下游 noCacheTabIds
 * 的依赖项，引用变动会引发整条派生链重算。
 */
const EMPTY_NO_CACHE_SET: ReadonlySet<number> = new Set();

export interface SearchControllerOptions {
  /** 当前窗口标签（不含其他窗口）。 */
  tabs: readonly TabRecord[];
  /** 翻译函数（分区/标签标题回退用）；切换语言时引用变化会触发重建。 */
  t: (key: string, options?: Record<string, unknown>) => string;
  searchAllWindows: boolean;
  pinyinSearch: boolean;
  noCacheEnabled: boolean;
  noCachePatterns: readonly string[];
}

export interface SearchController {
  query: string;
  setQuery: (query: string) => void;
  clearQuery: () => void;
  isFiltering: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** 过滤后的标签集（非过滤态恒等于入参 tabs）。 */
  filteredTabs: TabRecord[];
  /**
   * 命中序列（按相关度）。
   * 键盘漫游在搜索态的序列来源 —— 漫游本身由 useListNavigation 统一承担
   * （空态也能漫游，两态共用一套 ↑↓/Enter 语义）。
   */
  searchHitTabIds: number[];
  /** 命中「开发者禁缓存」规则的标签 id 集合（空规则时为空集单例）。 */
  noCacheTabIds: ReadonlySet<number>;
  /** 搜索框按键：仅 Esc（清空 + 失焦）；↑↓ / Enter 由 useListNavigation 承担。 */
  handleSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function useSearchController(options: SearchControllerOptions): SearchController {
  const { tabs, t, searchAllWindows, pinyinSearch, noCacheEnabled, noCachePatterns } = options;

  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 全窗口搜索数据源（设置开启且输入非空时，异步补充其他窗口标签；默认仅当前窗口）
  const otherTabs = useAllWindowTabs(searchAllWindows, query);

  const isFiltering = query.trim().length > 0;
  // 搜索用标签集：开启全窗口搜索且输入中时并入其他窗口标签（其余场景恒等于当前窗口）
  const effectiveTabs = useMemo(
    () => (isFiltering && searchAllWindows ? [...tabs, ...otherTabs] : (tabs as TabRecord[])),
    [tabs, otherTabs, isFiltering, searchAllWindows]
  );

  // 命中「开发者禁缓存」规则的标签 id 集合（侧边栏 TabRow 角标用）
  const noCacheTabIds = useMemo(() => {
    const patterns = noCacheEnabled ? noCachePatterns : [];
    if (patterns.length === 0) return EMPTY_NO_CACHE_SET;
    const matched = new Set<number>();
    for (const tab of effectiveTabs) {
      const url = tab.url;
      if (!url) continue;
      if (patterns.some((pattern) => matchesNoCachePattern(url, pattern))) matched.add(tab.id);
    }
    return matched;
    // EMPTY_NO_CACHE_SET 是模块级常量，非响应式值，不进依赖数组。
  }, [noCacheEnabled, noCachePatterns, effectiveTabs]);

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
        { pinyin: pinyinSearch }
      ),
    [effectiveTabs, t, pinyinSearch]
  );

  /**
   * 拼音目标是异步补齐的（词典按需动态加载），补齐本身不改变任何 React 状态。
   * 没有这个信号，拼音命中会一直不出现：既不会在首次输入时自愈，也会在
   * 「标签事件 → 重建引擎」后把已有的拼音结果瞬间清空。
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

  /** 命中序列（按相关度）：键盘漫游在搜索态的序列来源，见 useListNavigation。 */
  const searchHitTabIds = useMemo(() => searchHits.map((hit) => hit.tabId), [searchHits]);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      searchInputRef.current?.blur();
    }
  }, []);

  const clearQuery = useCallback(() => setQuery(''), []);

  return {
    query,
    setQuery,
    clearQuery,
    isFiltering,
    searchInputRef,
    filteredTabs,
    searchHitTabIds,
    noCacheTabIds,
    handleSearchKeyDown
  };
}
