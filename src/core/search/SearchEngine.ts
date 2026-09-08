import { prepare, single, type Prepared, type Result } from 'fuzzysort';

/**
 * 搜索内核：标题 + URL + 中文拼音首字母的模糊匹配。
 *
 * 设计：
 *  - 索引构建时预计算 prepare（标题/URL），查询零准备；
 *  - 拼音支持：中文标题同时建「首字母串」与「全拼串」两套目标（如 "tb" 与 "taobao"
 *    都能命中 "淘宝"）。
 *    拼音词典（pinyin-pro，体积约 1MB+）**按需动态加载**——只在开启拼音搜索且
 *    首次构造引擎时异步拉取，绝不进 popup / sidepanel 的初始解析。关闭拼音搜索
 *    （settings.pinyinSearch=false）时完全不加载该词典。
 *  - 结果排序：命中分数降序，激活标签优先；
 *  - 命中高亮：toSegments 输出纯文本命中分段（无 HTML），由渲染层负责加粗，
 *    React 自动转义，XSS 面为零。
 */

/**
 * pinyin-pro 动态加载器（模块级缓存单例）。
 * 静态 import 会把整本拼音词典打进 popup 初始包，拖垮"秒开"切换器；
 * 改为 import() 后 Vite 自动拆为独立 chunk，且仅在首次用到时下载。
 */
type PinyinFn = (typeof import('pinyin-pro'))['pinyin'];
let pinyinModulePromise: Promise<typeof import('pinyin-pro')> | null = null;
/** 已解析的词典函数；非 null 表示词典就绪，此后新建的引擎可**同步**补齐拼音目标。 */
let cachedPinyin: PinyinFn | null = null;
function loadPinyin() {
  if (!pinyinModulePromise) {
    pinyinModulePromise = import('pinyin-pro').then((mod) => {
      cachedPinyin = mod.pinyin;
      return mod;
    });
  }
  return pinyinModulePromise;
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

export class SearchEngine {
  private readonly targets: PreparedTarget[];
  /** 懒加载占位：null 未触发、Promise 进行中或已完成。保证词典只下载一次。 */
  private pinyinLoading: Promise<void> | null = null;
  private readonly pinyinEnabled: boolean;

  constructor(tabs: readonly SearchableTab[], options: SearchEngineOptions = {}) {
    const pinyinEnabled = options.pinyin ?? true;
    this.pinyinEnabled = pinyinEnabled;
    // 构造期只做轻量 fuzzysort 准备。拼音目标的处理分两种口径：
    //  - 词典已就绪（cachedPinyin 非空）：同步补齐，本引擎从第一帧起就能拼音匹配；
    //    「每次标签事件重建引擎 → 拼音结果瞬间消失」正是由此消除。
    //  - 尚未就绪：留 null 并异步补，避免首屏为等 1MB+ 词典而阻塞。
    this.targets = tabs.map((tab) => {
      const target: PreparedTarget = {
        tab,
        title: prepare(tab.title),
        url: prepare(tab.url),
        pinyinFirst: null,
        pinyinFull: null
      };
      if (pinyinEnabled && cachedPinyin) fillPinyin(target, cachedPinyin);
      return target;
    });
    if (pinyinEnabled && !cachedPinyin) void this.ensurePinyin();
  }

  /**
   * 拼音目标是否已全部就绪（关闭拼音搜索时恒为 true —— 不存在待补的目标）。
   *
   * 消费方需要它：拼音目标是异步补齐的，而补齐本身不改变任何 React 状态，
   * 没有这个信号，UI 的搜索结果 memo 不会重算，拼音命中会一直不出现。
   */
  get pinyinReady(): boolean {
    if (!this.pinyinEnabled) return true;
    return this.targets.every(
      (target) => target.pinyinFirst !== null && target.pinyinFull !== null
    );
  }

  /**
   * 懒加载拼音词典并为全部目标补 prepare（首次搜索前最好已就绪）。
   * 模块级 loadPinyin() 缓存了 import() 结果，因此：
   *  - 多个引擎实例并发构造只触发一次词典下载；
   *  - 词典就绪后仅为未填的目标做轻量 prepare（fuzzysort），已填则跳过。
   * 关闭拼音搜索（pinyin=false）时构造期不会调用本方法，词典全程不下载。
   */
  async ensurePinyin(): Promise<void> {
    if (!this.pinyinEnabled) return;
    if (this.pinyinLoading) return this.pinyinLoading;
    this.pinyinLoading = (async () => {
      const { pinyin } = await loadPinyin();
      for (const target of this.targets) {
        if (target.pinyinFirst === null || target.pinyinFull === null) {
          fillPinyin(target, pinyin);
        }
      }
    })();
    return this.pinyinLoading;
  }

  /** 空查询返回空结果。 */
  search(input: string, limit = 50): SearchHit[] {
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
