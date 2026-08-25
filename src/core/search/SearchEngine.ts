import { prepare, single, type Prepared, type Result } from 'fuzzysort';
import { pinyin } from 'pinyin-pro';

/**
 * 搜索内核：标题 + URL + 中文拼音首字母的模糊匹配。
 *
 * 设计（FR-D2.1）：
 *  - 索引构建时预计算 prepare（标题/URL/拼音三目标），查询零准备；
 *  - 拼音支持：中文标题的首字母串（如 "gh" 命中 "GitHub" 前的中文标题）；
 *  - 结果排序：命中分数降序，激活标签优先；
 *  - 命中高亮：toSegments 输出纯文本命中分段（无 HTML），由渲染层负责加粗，
 *    React 自动转义，XSS 面为零。
 */

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
  pinyinFirst: Prepared | null;
}

const URL_WEIGHT = 8;
const PINYIN_WEIGHT = 4;

function firstLetterPinyin(title: string): string {
  // 首字母模式：["t","h","g"] → "thg"
  return pinyin(title, { pattern: 'first', toneType: 'none', type: 'array' })
    .map((chunk) => chunk[0] ?? '')
    .join('')
    .toLowerCase();
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

  constructor(tabs: readonly SearchableTab[], options: SearchEngineOptions = {}) {
    const pinyinEnabled = options.pinyin ?? true;
    this.targets = tabs.map((tab) => ({
      tab,
      title: prepare(tab.title),
      url: prepare(tab.url),
      pinyinFirst: pinyinEnabled ? prepare(firstLetterPinyin(tab.title)) : null
    }));
  }

  /** 空查询返回空结果。 */
  search(input: string, limit = 50): SearchHit[] {
    const query = input.trim().toLowerCase();
    if (!query) return [];

    const hits: Array<{ tab: SearchableTab; score: number; title?: Result; url?: Result }> = [];

    for (const target of this.targets) {
      const titleResult = single(query, target.title);
      const urlResult = single(query, target.url);
      const pinyinResult =
        target.pinyinFirst !== null ? single(query, target.pinyinFirst) : null;

      const candidates: Array<{ score: number; title?: Result; url?: Result }> = [];
      if (titleResult) candidates.push({ score: titleResult.score, title: titleResult });
      if (urlResult) candidates.push({ score: urlResult.score - URL_WEIGHT, url: urlResult });
      if (pinyinResult) candidates.push({ score: pinyinResult.score - PINYIN_WEIGHT });
      if (candidates.length > 0) {
        let best = candidates[0]!;
        for (const candidate of candidates) {
          if (candidate.score > best.score) best = candidate;
        }
        hits.push({ tab: target.tab, score: best.score, title: best.title, url: best.url });
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
