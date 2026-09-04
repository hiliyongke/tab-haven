import { describe, expect, it } from 'vitest';
import { SearchEngine } from '@/core/search/SearchEngine';

/**
 * 性能规格测试（PRD 5.1 → 回归门禁）：
 *  - 「搜索输入到结果呈现 < 100ms（150 标签规模）」—— 单测覆盖纯计算部分
 *    （索引已构建后的查询路径）；DOM 渲染与冷启动（<500ms）无法在单测环境
 *    度量，需真机基准（见 docs/PRODUCT-ANALYSIS-2026-08-26.md T5 说明）。
 *  - 索引构建（fuzzysort prepare + 拼音首字母）为标签变更时的一次性成本，
 *    单独设阈值防回归。
 *
 * 阈值口径：断言取多轮查询的最大耗时，阈值放宽于真机指标（CI 机器抖动），
 * 用于捕获数量级回归（如 100ms → 5s），不做纳秒级守门。
 */

/** 构造贴近真实规模的标签集：中英混排标题 + 多样化域名。 */
function buildTabs(count: number): Array<{ id: number; title: string; url: string; active: boolean }> {
  const sites = [
    'github.com', 'cloud.tencent.com', 'developer.mozilla.org', 'stackoverflow.com',
    'zh.wikipedia.org', 'juejin.cn', 'www.zhihu.com', 'news.ycombinator.com',
    'www.ruanyifeng.com', 'react.dev', 'wxt.dev', 'chromewebstore.google.com'
  ];
  const topics = ['文档', '入门教程', '深度解析', 'Release Notes', '最佳实践', '源码阅读', '周报', '知乎问答'];
  return Array.from({ length: count }, (_, index) => {
    const site = sites[index % sites.length]!;
    const topic = topics[index % topics.length]!;
    return {
      id: index + 1,
      title: `${topic} · ${site} #${index + 1}`,
      url: `https://${site}/path/${index + 1}?ref=tabs`,
      active: index === 0
    };
  });
}

describe('SearchEngine 性能规格（PRD 5.1）', () => {
  it('150 标签规模：单次查询 < 100ms（含拼音/URL 三目标）', () => {
    const tabs = buildTabs(150);
    const engine = new SearchEngine(tabs);
    const queries = ['git', '文档', 'wk', 'wj', 'release', 'zhihu', '深度', 'dev', 'x', 'com'];
    let maxMs = 0;
    for (const query of queries) {
      const start = performance.now();
      engine.search(query);
      maxMs = Math.max(maxMs, performance.now() - start);
    }
    // 附加校验：查询确实命中（防止「快是因为啥都没做」的假通过）
    expect(engine.search('文档')).not.toHaveLength(0);
    expect(maxMs).toBeLessThan(100);
  });

  it('150 标签索引构建 < 1000ms（标签变更时的一次性成本）', () => {
    const tabs = buildTabs(150);
    const start = performance.now();
    void new SearchEngine(tabs);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('压力余量：500 标签规模单次查询仍 < 100ms', () => {
    const tabs = buildTabs(500);
    const engine = new SearchEngine(tabs);
    const queries = ['git', '文档', 'wj', 'stack'];
    let maxMs = 0;
    for (const query of queries) {
      const start = performance.now();
      engine.search(query);
      maxMs = Math.max(maxMs, performance.now() - start);
    }
    expect(maxMs).toBeLessThan(100);
  });
});
