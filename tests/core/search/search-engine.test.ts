import { describe, expect, it } from 'vitest';
import { SearchEngine } from '@/core/search/SearchEngine';

/**
 * 行为规格（FR-D2.1）：模糊匹配、首字母/拼音命中、激活优先排序、高亮。
 */
const tabs = [
  { id: 1, title: 'GitHub · TabHaven 开发', url: 'https://github.com/example', active: false },
  { id: 2, title: '腾讯云控制台', url: 'https://console.cloud.tencent.com/', active: false },
  { id: 3, title: '今日热榜', url: 'https://example.com/hot', active: true },
  { id: 4, title: 'GitLab', url: 'https://gitlab.com/', active: false }
];

describe('SearchEngine', () => {
  it('空查询返回空结果', () => {
    const engine = new SearchEngine(tabs);
    expect(engine.search('')).toHaveLength(0);
    expect(engine.search('   ')).toHaveLength(0);
  });

  it('子串匹配标题', () => {
    const engine = new SearchEngine(tabs);
    const hits = engine.search('热榜');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.tabId).toBe(3);
  });

  it('URL 匹配', () => {
    const engine = new SearchEngine(tabs);
    const hits = engine.search('gitlab.com');
    expect(hits.some((hit) => hit.tabId === 4)).toBe(true);
  });

  it('拼音首字母命中中文标题（frb 命中"今日热榜"）', () => {
    const engine = new SearchEngine(tabs);
    const hits = engine.search('jrrb');
    expect(hits.some((hit) => hit.tabId === 3)).toBe(true);
  });

  it('命中高亮输出 <b> 标记', () => {
    const engine = new SearchEngine(tabs);
    const hits = engine.search('热榜');
    expect(hits[0]?.titleMarkup).toContain('<b');
  });

  it('模糊子序列匹配（gt 命中 GitHub）', () => {
    const engine = new SearchEngine(tabs);
    const hits = engine.search('gt');
    expect(hits.some((hit) => hit.tabId === 1)).toBe(true);
  });

  it('结果截断（limit）', () => {
    const engine = new SearchEngine(tabs);
    expect(engine.search('example', 2).length).toBeLessThanOrEqual(2);
  });
});
