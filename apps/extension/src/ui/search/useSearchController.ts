import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { SearchEngine } from '@/core/search/SearchEngine';
import { isImeComposing } from '@/core/util/keyboard';
import {
  buildHistoryTargets,
  decodeHistoryId,
  HISTORY_SNAPSHOT_LIMIT,
  type HistoryHitInfo
} from '@/core/search/historyIndex';
import { matchesNoCachePattern } from '@/platform/nocache/noCacheRules';
import { usePinyinDictionary } from '@/ui/search/usePinyinDictionary';
import type { Snapshot } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { useAllWindowTabs } from '@/ui/search/useAllWindowTabs';

/**
 * 常驻搜索：查询状态、模糊搜索引擎、命中/过滤、键盘导航、以及禁缓存角标集。
 * 三个**不显眼但已知踩过坑**的点：
 *
 * 1. **拼音能否启用是引擎的构造入参，不是事后补丁**：词典 1MB+ 必须动态加载，
 *    而引擎构造后不可变；故由 `usePinyinDictionary` 在词典就绪后翻转信号，
 *    引擎 memo 随之重建（引用变化即重算），不存在「补了拼音但没人知道」。
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

/**
 * 历史（快照/归档）命中返回条数上限。
 *
 * 刻意与 SearchEngine 的 DEFAULT_SEARCH_LIMIT 分开：标签区靠滚动承载全部结果，
 * 历史区是「补充入口」，只给一屏的量，多了反而把标签区挤出视野。
 */
const HISTORY_HITS_LIMIT = 20;

interface SearchControllerOptions {
  /** 当前窗口标签（不含其他窗口）。 */
  tabs: readonly TabRecord[];
  /** 翻译函数（分区/标签标题回退用）；切换语言时引用变化会触发重建。 */
  t: (key: string, options?: Record<string, unknown>) => string;
  searchAllWindows: boolean;
  pinyinSearch: boolean;
  /** 时间线搜索开关：开启后搜索同时命中快照与归档条目。 */
  searchHistory: boolean;
  /** 快照族数据源（时间线索引用；为空数组时历史命中恒空）。 */
  snapshots: readonly Snapshot[];
  noCacheEnabled: boolean;
  noCachePatterns: readonly string[];
}

export interface HistorySearchHit extends HistoryHitInfo {
  /** 标题命中分段（与当前标签命中同结构，渲染层加粗）。 */
  titleSegments: Array<{ text: string; hit: boolean }>;
}

interface SearchController {
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
  /**
   * 历史命中：查询命中快照 / 归档条目的解码结果（按相关度，上限 20 条）。
   * 仅当 searchHistory 开启且查询非空时非空数组。
   */
  historyHits: HistorySearchHit[];
  /** 搜索框按键：仅 Esc（清空 + 失焦）；↑↓ / Enter 由 useListNavigation 承担。 */
  handleSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function useSearchController(options: SearchControllerOptions): SearchController {
  const {
    tabs,
    t,
    searchAllWindows,
    pinyinSearch,
    searchHistory,
    snapshots,
    noCacheEnabled,
    noCachePatterns
  } = options;

  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 全窗口搜索数据源（设置开启且输入非空时，异步补充其他窗口标签；默认仅当前窗口）
  /**
   * 输入回显必须即时，但**搜索计算**可以滞后一帧。
   *
   * 每敲一个字符都要对上千标签跑一遍 fuzzysort（开启拼音时还要过一遍拼音索引），
   * 长列表下会与输入争抢主线程 —— 表现为打字卡顿，而不是「结果稍晚」。
   * `useDeferredValue` 让 React 先把输入与列表骨架渲染出来，命中在下一轮空闲
   * 渲染时再更新：用户感知是结果晚一帧，不是界面卡住。
   */
  const deferredQuery = useDeferredValue(query);

  const otherTabs = useAllWindowTabs(searchAllWindows, deferredQuery);

  const isFiltering = deferredQuery.trim().length > 0;
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

  /**
   * 常驻搜索：输入即过滤下方列表（fuzzysort 内核：标题 / URL / 拼音可选）。
   *
   * **惰性构造**：只在正在输入（`isFiltering`）时才建引擎。构造期要对每个标签跑
   * `prepare()`，开启拼音时还要同步跑一遍 pinyin-pro；而它依赖的 `effectiveTabs`
   * 会随任何标签快照变化（标题 / 静音 / 激活状态），不惰性的话 1000 标签场景里
   * 每次快照都要重建一次，用户**根本没在搜索**时也持续烧 CPU。
   * 与下方 `historyEngine` 同款惰性口径（历史引擎只在开关打开时构造）。
   */
  // 拼音是构造入参：词典就绪前后各建一次引擎（构造只是轻量 prepare），
  // 不给「引擎内部异步补齐」留位置——那会让引擎成为可变对象，命中结果
  // 在 React 看来毫无变化（拼音命中静默失效的根因）。
  const pinyinUsable = usePinyinDictionary(pinyinSearch);
  const engine = useMemo(
    () =>
      isFiltering
        ? new SearchEngine(
            effectiveTabs.map((tab) => ({
              id: tab.id,
              title: tab.title || t('无标题标签'),
              url: tab.url || '',
              active: tab.active
            })),
            { pinyin: pinyinUsable }
          )
        : null,
    [isFiltering, effectiveTabs, t, pinyinUsable]
  );

  // 时间线搜索引擎：快照条目映射为负数合成 id 目标，与主引擎同内核。
  // 只在开启历史搜索时构造——快照数据不动则引擎引用稳定，不会随标签事件重建。
  const historyEngine = useMemo(
    () =>
      searchHistory
        ? new SearchEngine(buildHistoryTargets(snapshots), { pinyin: pinyinUsable })
        : null,
    [searchHistory, snapshots, pinyinUsable]
  );

  const searchHits = useMemo(() => {
    // 引擎为空 = 没在输入：此时没有命中，也不必付搜索的代价。
    return engine === null ? [] : engine.search(deferredQuery, Math.max(effectiveTabs.length, 50));
  }, [engine, deferredQuery, effectiveTabs.length]);

  /**
   * 历史命中：合成 id 命中后立即解码为结构化信息（快照名 / 来源 / 时间 / 条目）。
   * 解码需要与构造时同序的快照列表，故依赖 snapshots 原引用而非排序副本。
   */
  const historyHits = useMemo(() => {
    if (!historyEngine || !isFiltering) return [];
    // 与主引擎同走 deferredQuery：历史引擎同样要过 fuzzysort（+拼音索引），
    // 用即时 query 会让它抢在输入框回显之前跑，把「结果晚一帧」的延迟策略
    // （上面的 useDeferredValue 说明）只对一半的输入生效。
    const raw = historyEngine.search(deferredQuery, HISTORY_HITS_LIMIT);
    const decoded: HistorySearchHit[] = [];
    for (const hit of raw) {
      const info = decodeHistoryId(hit.tabId, snapshots, HISTORY_SNAPSHOT_LIMIT);
      if (!info) continue;
      decoded.push({ ...info, titleSegments: hit.titleSegments });
    }
    return decoded;
  }, [historyEngine, deferredQuery, isFiltering, snapshots]);

  const filteredTabs = useMemo(() => {
    if (!query.trim()) return effectiveTabs;
    const hitIds = new Set(searchHits.map((hit) => hit.tabId));
    return effectiveTabs.filter((tab) => hitIds.has(tab.id));
  }, [query, searchHits, effectiveTabs]);

  /** 命中序列（按相关度）：键盘漫游在搜索态的序列来源，见 useListNavigation。 */
  const searchHitTabIds = useMemo(() => searchHits.map((hit) => hit.tabId), [searchHits]);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    // 输入法组合中 Esc 是「取消候选」，不能顺手清空搜索并把焦点扔出去。
    if (isImeComposing(event)) return;
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
    historyHits,
    handleSearchKeyDown
  };
}
