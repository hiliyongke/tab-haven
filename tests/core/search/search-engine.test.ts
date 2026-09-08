import { describe, expect, it } from 'vitest';
import { SearchEngine } from '@/core/search/SearchEngine';

/**
 * 行为规格（FR-D2.1）：模糊匹配、首字母/拼音命中、激活优先排序、高亮。
 */
const tabs = [
  { id: 1, title: 'GitHub · Tabs 开发', url: 'https://github.com/example', active: false },
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

  it('拼音首字母命中中文标题（jrrb 命中"今日热榜"）', async () => {
    const engine = new SearchEngine(tabs);
    // 拼音词典改为动态加载：构造后需先 await 就绪，再搜索才有拼音匹配。
    await engine.ensurePinyin();
    const hits = engine.search('jrrb');
    expect(hits.some((hit) => hit.tabId === 3)).toBe(true);
  }, 20000); // 首次动态 import('pinyin-pro')（约 1MB）在沙箱内偶发 2–6s，放宽以防偶发超时（非逻辑回归）。

  it('拼音全拼命中中文标题（jinribang 命中"今日热榜"）', async () => {
    const engine = new SearchEngine(tabs);
    await engine.ensurePinyin();
    const hits = engine.search('jinribang');
    expect(hits.some((hit) => hit.tabId === 3)).toBe(true);
    // 全拼与首字母互不冲突：首字母仍应命中
    expect(engine.search('jrrb').some((hit) => hit.tabId === 3)).toBe(true);
  }, 20000);

  it('拼音全拼命中含英文的混合标题（github 命中"腾讯云...GitHub"无关；验证"我的GitHub"式拼接）', async () => {
    const engine = new SearchEngine([
      { id: 5, title: '我的GitHub主页', url: 'https://github.com/me', active: false }
    ]);
    await engine.ensurePinyin();
    expect(engine.search('wodegithub').some((hit) => hit.tabId === 5)).toBe(true);
    expect(engine.search('github').some((hit) => hit.tabId === 5)).toBe(true);
  }, 20000);

  it('词典就绪后新建的引擎同步具备拼音能力（无异步空窗，防结果闪回）', async () => {
    // 先让模块级词典加载完成
    const warmup = new SearchEngine(tabs);
    await warmup.ensurePinyin();
    // 侧边栏每次标签快照都会重建引擎：若词典就绪后仍要等一拍，拼音命中会在
    // 重建瞬间全部消失，直到用户再次按键才回来。
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
