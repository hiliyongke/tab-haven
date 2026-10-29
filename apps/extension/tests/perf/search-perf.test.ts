import { describe, expect, it } from 'vitest';
import { SearchEngine } from '@/core/search/SearchEngine';

/**
 * 搜索性能规格：150 标签下索引后查询中位数低于 100ms，索引构建低于 1000ms；
 * 500 标签下查询中位数低于 300ms。
 *
 * 单测覆盖纯计算路径；DOM 渲染与冷启动耗时不在度量范围内。索引构建是标签变更时
 * 的一次性成本，单独设置阈值；拼音词典按需加载，不计入本文件的查询测量。
 *
 * 测量前预热搜索引擎，并按标签规模设置阈值；多轮取中位数以降低 GC 与调度波动的
 * 影响。本文件只测量搜索性能，不与其他用例争抢 CPU。
 */

/** 构造贴近真实规模的标签集：中英混排标题 + 多样化域名。 */
function buildTabs(
  count: number
): Array<{ id: number; title: string; url: string; active: boolean }> {
  const sites = [
    'github.com',
    'cloud.example.com',
    'developer.mozilla.org',
    'stackoverflow.com',
    'zh.wikipedia.org',
    'juejin.cn',
    'www.zhihu.com',
    'news.ycombinator.com',
    'www.ruanyifeng.com',
    'react.dev',
    'wxt.dev',
    'chromewebstore.google.com'
  ];
  const topics = [
    '文档',
    '入门教程',
    '深度解析',
    'Release Notes',
    '最佳实践',
    '源码阅读',
    '周报',
    '知乎问答'
  ];
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

/** 预热搜索引擎，避免初始化耗时计入单次查询测量。 */
function warmUp(engine: SearchEngine): void {
  for (const query of ['git', '文档', 'wk', 'release']) engine.search(query);
}

/** 多轮取中位数，降低单次测量波动的影响。 */
function medianQueryMs(engine: SearchEngine, queries: readonly string[], rounds = 5): number {
  const samples: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const query of queries) {
      const start = performance.now();
      engine.search(query);
      samples.push(performance.now() - start);
    }
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

describe('SearchEngine 性能规格', () => {
  it('150 标签规模：单次查询中位数 < 100ms（含拼音/URL 三目标）', () => {
    const tabs = buildTabs(150);
    const engine = new SearchEngine(tabs);
    warmUp(engine);
    const queries = ['git', '文档', 'wk', 'wj', 'release', 'zhihu', '深度', 'dev', 'x', 'com'];

    // 确认查询有命中结果后再评估耗时。
    expect(engine.search('文档')).not.toHaveLength(0);
    expect(medianQueryMs(engine, queries)).toBeLessThan(100);
  });

  it('150 标签索引构建 < 1000ms（标签变更时的一次性成本）', () => {
    const tabs = buildTabs(150);
    // 先构建一次完成模块初始化，再测量稳态构建成本。
    void new SearchEngine(tabs);
    const start = performance.now();
    void new SearchEngine(tabs);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('压力余量：500 标签规模单次查询中位数 < 300ms', () => {
    const tabs = buildTabs(500);
    const engine = new SearchEngine(tabs);
    warmUp(engine);
    const queries = ['git', '文档', 'wj', 'stack'];

    expect(medianQueryMs(engine, queries)).toBeLessThan(300);
  });
});
