import { describe, expect, it } from 'vitest';
import { SearchEngine } from '@/core/search/SearchEngine';

/**
 * 性能规格测试（PRD 5.1 → 回归门禁）：
 *  - 「搜索输入到结果呈现 < 100ms（150 标签规模）」—— 单测覆盖纯计算部分
 *    （索引已构建后的查询路径）；DOM 渲染与冷启动（<500ms）无法在单测环境度量。
 *  - 索引构建（fuzzysort prepare + 拼音首字母）为标签变更时的一次性成本，
 *    单独设阈值防回归。
 *
 * 阈值口径与防 flaky：
 *  - **预热**：首个查询要承担 fuzzysort + pinyin-pro 的首次加载与 JIT 编译，
 *    直接计时会把一次性成本算进「单次查询」，在 CI 冷机上足以翻几十倍。
 *  - **取中位数**而非最大值：单次毛刺（GC、调度抢占）不应判死刑；
 *    中位数仍能稳定捕获数量级回归，这才是本测试要守的东西。
 *  - **阈值按规模分档**：500 标签与 150 标签用同一阈值并不合理，
 *    规模大 3 倍仍要求同样的耗时，等于把偶发抖动放大成必然失败。
 *  - 本文件只做纯计算，不与其他用例争抢 CPU（规模测试自身即负载）。
 */

/** 构造贴近真实规模的标签集：中英混排标题 + 多样化域名。 */
function buildTabs(
  count: number
): Array<{ id: number; title: string; url: string; active: boolean }> {
  const sites = [
    'github.com',
    'cloud.tencent.com',
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

/** 预热：让 fuzzysort / pinyin-pro 完成首次加载与 JIT，避免一次性成本计入测量。 */
function warmUp(engine: SearchEngine): void {
  for (const query of ['git', '文档', 'wk', 'release']) engine.search(query);
}

/** 多轮取中位数：抗单次毛刺，仍能捕获数量级回归。 */
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

describe('SearchEngine 性能规格（PRD 5.1）', () => {
  it('150 标签规模：单次查询中位数 < 100ms（含拼音/URL 三目标）', () => {
    const tabs = buildTabs(150);
    const engine = new SearchEngine(tabs);
    warmUp(engine);
    const queries = ['git', '文档', 'wk', 'wj', 'release', 'zhihu', '深度', 'dev', 'x', 'com'];

    // 附加校验：查询确实命中（防止「快是因为啥都没做」的假通过）
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
