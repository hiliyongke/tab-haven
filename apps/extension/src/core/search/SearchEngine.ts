import { prepare, single, type Prepared, type Result } from 'fuzzysort';

/**
 * 搜索内核：标题 + URL + 中文拼音（首字母串 + 全拼串）的模糊匹配。
 * 拼音词典 pinyin-pro 体积大，按需动态 import()（仅开启拼音搜索时预加载）。
 * 引擎构造后不可变：拼音目标在构造期同步补齐，词典就绪后重建引擎。
 * 命中分段输出纯文本（无 HTML），由渲染层加粗，XSS 面为零。
 */

/** pinyin-pro 动态加载器（模块级缓存单例），Vite 自动拆为独立 chunk，首次用到才下载。 */
type PinyinFn = (typeof import('pinyin-pro'))['pinyin'];
let pinyinModulePromise: Promise<typeof import('pinyin-pro')> | null = null;
/** 已解析的词典函数；非 null 表示词典就绪，此后新建的引擎可**同步**补齐拼音目标。 */
let cachedPinyin: PinyinFn | null = null;
function loadPinyin() {
  if (!pinyinModulePromise) {
    pinyinModulePromise = import('pinyin-pro')
      .then((mod) => {
        cachedPinyin = mod.pinyin;
        return mod;
      })
      .catch((error: unknown) => {
        // 失败必须允许重试：不重置的话 promise 永久 rejected，此后每次重建
        // 搜索引擎（标签事件 40ms 节流下高频发生）都会派生一个新的
        // unhandled rejection，把诊断环形缓冲刷满。
        pinyinModulePromise = null;
        throw error;
      });
  }
  return pinyinModulePromise;
}

/**
 * 词典是否已就绪（模块级缓存命中）。
 * 返回 true 时新建引擎可在构造期**同步**补齐拼音目标，不存在异步空窗。
 */
export function isPinyinDictionaryReady(): boolean {
  return cachedPinyin !== null;
}

/**
 * 预加载拼音词典：成功返回 true，失败返回 false（**不抛出**）。
 *
 * 失败以返回值而非异常表达：core 层没有日志通道，留痕与降级由调用方决定；
 * 而 `loadPinyin()` 已在失败时重置缓存 promise，故后续仍可重试。
 */
export async function preloadPinyinDictionary(): Promise<boolean> {
  try {
    await loadPinyin();
    return true;
  } catch {
    return false;
  }
}

interface SearchableTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

interface SearchEngineOptions {
  /** 是否包含中文拼音首字母匹配（默认 true）。 */
  pinyin?: boolean;
}

interface HighlightSegment {
  text: string;
  /** 是否命中（命中段由渲染层加粗，文本由 React 自动转义，杜绝 XSS）。 */
  hit: boolean;
}

interface SearchHit {
  tabId: number;
  /** 标题按命中索引展开的分段（纯文本，渲染层负责转义与加粗）。 */
  titleSegments: HighlightSegment[];
}

interface PreparedTarget {
  tab: SearchableTab;
  title: Prepared;
  url: Prepared;
  /** 拼音首字母目标；null 表示尚未懒准备（词典未加载或关闭拼音搜索）。 */
  pinyinFirst: Prepared | null;
  /** 拼音全拼目标（"淘宝"→"taobao"）；null 表示尚未懒准备。 */
  pinyinFull: Prepared | null;
}

const URL_WEIGHT = 8;
const PINYIN_WEIGHT = 4;

/**
 * 默认结果条数上限。
 *
 * 与「索引多少份历史快照」（`historyIndex` 的 HISTORY_SNAPSHOT_LIMIT = 20）**不是
 * 一回事**：那个是索引规模，这个是单次查询返回的条数（50）。两个旋钮取值不同，
 * 却极易被当成同一个（调索引规模不会改变单页返回条数，反之亦然），故显式命名区分。
 */
export const DEFAULT_SEARCH_LIMIT = 50;

function firstLetterPinyin(title: string, pinyin: (typeof import('pinyin-pro'))['pinyin']): string {
  // 首字母模式：["t","h","g"] → "thg"
  return pinyin(title, { pattern: 'first', toneType: 'none', type: 'array' })
    .map((chunk) => chunk[0] ?? '')
    .join('')
    .toLowerCase();
}

function fullPinyin(title: string, pinyin: (typeof import('pinyin-pro'))['pinyin']): string {
  // 全拼模式：["tao","bao"] → "taobao"（无空格拼接，供 fuzzysort 子序列匹配，
  // 这样输入 "taobao" 也能命中 "淘宝"；非汉字字符 pinyin-pro 原样保留，
  // 故 "我的GitHub" → "wodegithub"，输入 "github" 仍命中）。
  return pinyin(title, { toneType: 'none', type: 'array' }).join('').toLowerCase();
}

/** 为一个目标补齐两套拼音 prepare（已填的会重算，调用方负责判空）。 */
function fillPinyin(target: PreparedTarget, pinyin: PinyinFn): void {
  target.pinyinFirst = prepare(firstLetterPinyin(target.tab.title, pinyin));
  target.pinyinFull = prepare(fullPinyin(target.tab.title, pinyin));
}

/**
 * 将 fuzzysort 命中索引展开为「命中 / 非命中」分段。
 * 只输出纯文本片段，由渲染层负责 HTML 转义与加粗，避免注入页面标题中的 HTML。
 */
function toSegments(target: string, result: Result | undefined): HighlightSegment[] {
  if (!result || !result.indexes || result.indexes.length === 0) {
    return [{ text: target, hit: false }];
  }
  const indexes = result.indexes; // 升序的命中字符下标
  const segments: HighlightSegment[] = [];
  let start = 0;
  for (const pos of indexes) {
    if (pos > start) segments.push({ text: target.slice(start, pos), hit: false });
    segments.push({ text: target[pos] ?? '', hit: true });
    start = pos + 1;
  }
  if (start < target.length) segments.push({ text: target.slice(start), hit: false });
  return segments;
}

/**
 * 三目标模糊搜索：标题 / 网址 / 拼音，命中返回按相关度降序的原目标引用。
 *
 * 引擎**构造后不可变**：拼音目标只在构造期按 `isPinyinDictionaryReady()` 的结果
 * 一次性补齐。词典尚未就绪时本引擎就是纯字面匹配引擎——调用方应在词典就绪后
 * 重建引擎（构造是轻量的 fuzzysort prepare），保持引擎状态不可变。
 */
export class SearchEngine {
  private readonly targets: PreparedTarget[];
  private readonly pinyinEnabled: boolean;

  constructor(tabs: readonly SearchableTab[], options: SearchEngineOptions = {}) {
    const pinyinEnabled = options.pinyin ?? true;
    this.pinyinEnabled = pinyinEnabled;
    this.targets = tabs.map((tab) => {
      const target: PreparedTarget = {
        tab,
        title: prepare(tab.title),
        url: prepare(tab.url),
        pinyinFirst: null,
        pinyinFull: null
      };
      // 词典已就绪则同步补齐：本引擎从第一帧起就能拼音匹配，
      // 「每次标签事件重建引擎 → 拼音结果瞬间消失」正是由此消除。
      if (pinyinEnabled && cachedPinyin) fillPinyin(target, cachedPinyin);
      return target;
    });
  }

  /**
   * 拼音目标是否已全部就绪（关闭拼音搜索时恒为 true —— 不存在待补的目标）。
   *
   * 词典未就绪却开了拼音时返回 false：此时本引擎只做标题 / URL 匹配，
   * 调用方可据此决定是否等词典就绪后重建。
   */
  get pinyinReady(): boolean {
    if (!this.pinyinEnabled) return true;
    return this.targets.every(
      (target) => target.pinyinFirst !== null && target.pinyinFull !== null
    );
  }

  /** 空查询返回空结果。 */
  search(input: string, limit = DEFAULT_SEARCH_LIMIT): SearchHit[] {
    const query = input.trim().toLowerCase();
    if (!query) return [];

    const hits: Array<{ tab: SearchableTab; score: number; title?: Result }> = [];

    for (const target of this.targets) {
      const titleResult = single(query, target.title);
      const urlResult = single(query, target.url);
      const pinyinResult = target.pinyinFirst !== null ? single(query, target.pinyinFirst) : null;
      const pinyinFullResult = target.pinyinFull !== null ? single(query, target.pinyinFull) : null;

      // urlResult 仅用于打分（决定该标签是否命中），命中分段只渲染标题，故不保留 url。
      const candidates: Array<{ score: number; title?: Result }> = [];
      if (titleResult) candidates.push({ score: titleResult.score, title: titleResult });
      if (urlResult) candidates.push({ score: urlResult.score - URL_WEIGHT });
      if (pinyinResult) candidates.push({ score: pinyinResult.score - PINYIN_WEIGHT });
      if (pinyinFullResult) candidates.push({ score: pinyinFullResult.score - PINYIN_WEIGHT });
      if (candidates.length > 0) {
        let best = candidates[0]!;
        for (const candidate of candidates) {
          if (candidate.score > best.score) best = candidate;
        }
        hits.push({ tab: target.tab, score: best.score, title: best.title });
      }
    }

    // 分数降序；同分时激活标签优先（保持搜索稳定性）
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.tab.active !== b.tab.active) return a.tab.active ? -1 : 1;
      return 0;
    });

    return hits.slice(0, limit).map((hit) => ({
      tabId: hit.tab.id,
      // 命中标题则按索引分段高亮；否则整段普通文本。均为纯文本，渲染层转义。
      titleSegments: hit.title
        ? toSegments(hit.tab.title, hit.title)
        : [{ text: hit.tab.title, hit: false }]
    }));
  }
}
