import { highlight, prepare, single, type Prepared, type Result } from 'fuzzysort';
import { pinyin } from 'pinyin-pro';

/**
 * 搜索内核：标题 + URL + 中文拼音首字母的模糊匹配。
 *
 * 设计（FR-D2.1）：
 *  - 索引构建时预计算 prepare（标题/URL/拼音三目标），查询零准备；
 *  - 拼音支持：中文标题的首字母串（如 "gh" 命中 "GitHub" 前的中文标题）；
 *  - 结果排序：命中分数降序，激活标签优先；
 *  - 命中高亮：fuzzysort.highlight 的受控输出（<b> 标记）。
 */

export interface SearchableTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export interface SearchHit {
  tabId: number;
  /** 标题命中的 HTML 高亮（fuzzysort.highlight 输出）。 */
  titleMarkup: string;
  /** URL 命中的 HTML 高亮。 */
  urlMarkup: string | undefined;
}

interface PreparedTarget {
  tab: SearchableTab;
  title: Prepared;
  url: Prepared;
  pinyinFirst: Prepared;
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

export class SearchEngine {
  private readonly targets: PreparedTarget[];

  constructor(tabs: readonly SearchableTab[]) {
    this.targets = tabs.map((tab) => ({
      tab,
      title: prepare(tab.title),
      url: prepare(tab.url),
      pinyinFirst: prepare(firstLetterPinyin(tab.title))
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
      const pinyinResult = single(query, target.pinyinFirst);

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
      titleMarkup:
        (hit.title && highlight(hit.title, '<b class="bg-amber-200">', '</b>')) ||
        escapeText(hit.tab.title),
      urlMarkup: hit.url ? highlight(hit.url, '<b class="bg-amber-200">', '</b>') : undefined
    }));
  }
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
