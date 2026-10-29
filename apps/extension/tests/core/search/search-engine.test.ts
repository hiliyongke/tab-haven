import { describe, expect, it } from 'vitest';
import {
  isPinyinDictionaryReady,
  preloadPinyinDictionary,
  SearchEngine
} from '@/core/search/SearchEngine';

/**
 * 行为规格：模糊匹配、首字母 / 拼音命中、激活优先排序、高亮。
 */
const tabs = [
  { id: 1, title: 'GitHub · Tabs 开发', url: 'https://github.com/example', active: false },
  { id: 2, title: '云平台控制台', url: 'https://console.cloud.example.com/', active: false },
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

  it('拼音首字母命中中文标题（jrrb 命中"今日热榜"）', async () => {
    // 引擎构造后不可变：词典必须在构造前就绪（preload 失败也应只降级拼音，不抛）。
    expect(await preloadPinyinDictionary()).toBe(true);
    const engine = new SearchEngine(tabs);
    expect(engine.pinyinReady).toBe(true);
    const hits = engine.search('jrrb');
    expect(hits.some((hit) => hit.tabId === 3)).toBe(true);
  }, 20000); // 为拼音词典加载预留时间。

  it('拼音全拼命中中文标题（jinribang 命中"今日热榜"）', async () => {
    await preloadPinyinDictionary();
    const engine = new SearchEngine(tabs);
    const hits = engine.search('jinribang');
    expect(hits.some((hit) => hit.tabId === 3)).toBe(true);
    // 全拼与首字母互不冲突：首字母仍应命中
    expect(engine.search('jrrb').some((hit) => hit.tabId === 3)).toBe(true);
  }, 20000);

  it('拼音全拼可匹配中英文混合标题', async () => {
    await preloadPinyinDictionary();
    const engine = new SearchEngine([
      { id: 5, title: '我的GitHub主页', url: 'https://github.com/me', active: false }
    ]);
    expect(engine.search('wodegithub').some((hit) => hit.tabId === 5)).toBe(true);
    expect(engine.search('github').some((hit) => hit.tabId === 5)).toBe(true);
  }, 20000);

  it('词典就绪后新建的引擎立即具备拼音能力', async () => {
    // 先让模块级词典加载完成
    await preloadPinyinDictionary();
    expect(isPinyinDictionaryReady()).toBe(true);
    // 标签快照变化后创建的新引擎，在词典就绪时立即支持拼音命中。
    const rebuilt = new SearchEngine(tabs);
    expect(rebuilt.pinyinReady).toBe(true);
    expect(rebuilt.search('jrrb').some((hit) => hit.tabId === 3)).toBe(true);
  }, 20000);

  it('关闭拼音搜索时 pinyinReady 恒为 true（没有待补的目标）', () => {
    const engine = new SearchEngine(tabs, { pinyin: false });
    expect(engine.pinyinReady).toBe(true);
    // 且不应因为拼音目标缺失而误命中
    expect(engine.search('jrrb').some((hit) => hit.tabId === 3)).toBe(false);
  });

  it('命中分段标记（hit=true 覆盖匹配子串，且可还原原始标题）', () => {
    const engine = new SearchEngine(tabs);
    const hits = engine.search('热榜');
    const hit = hits[0];
    expect(hit).toBeDefined();
    // 所有分段拼接应无损还原原始标题（纯文本、无 HTML 注入）
    const full = hit!.titleSegments.map((s) => s.text).join('');
    expect(full).toBe('今日热榜');
    // 至少存在一个命中分段，且其文本恰为被匹配的子串
    const matched = hit!.titleSegments.filter((s) => s.hit);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.map((s) => s.text).join('')).toBe('热榜');
  });

  it('标题含 HTML 特殊字符时仅作为纯文本分段（不注入）', () => {
    const engine = new SearchEngine([
      { id: 9, title: 'A < B & C <script>x</script>', url: 'https://x.com', active: false }
    ]);
    const hits = engine.search('B');
    const full = hits[0]?.titleSegments.map((s) => s.text).join('');
    expect(full).toBe('A < B & C <script>x</script>');
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
