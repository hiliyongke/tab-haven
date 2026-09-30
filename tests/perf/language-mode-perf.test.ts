import { describe, expect, it } from 'vitest';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { deriveSections } from '@/core/site/Sections';
import { planAutoGroups, planRegroup } from '@/core/group/AutoGrouping';

/**
 * 语言分组模式（settings.groupMode = 'language'）性能规格测试。
 *
 * 背景（**推断，未实测**）：该模式下 App.tsx:594-627 会对「未固定、未入原生组、
 * 尚无 language」的标签逐条发起 chrome.tabs.detectLanguage 异步探测，结果经
 * setLanguages 批量写回。担忧是「N 次异步探测 + N 轮全量派生」在大窗口下卡顿。
 *
 * 本文件**只测量、不优化**（task-15 / R19）：把这条链路上**可在单测环境测量的纯
 * 计算部分**量化，给出实测数字，作为是否需要升入 P1/P2 做优化的依据。
 *
 * 口径与 tests/perf/search-perf.test.ts:1-20 同款：
 *  - **预热**：首次派生承担模块初始化与 JIT，直接计时会把一次性成本算进单次耗时；
 *  - **取中位数**而非最大值：单次毛刺（GC、调度抢占）不应判死刑，中位数仍稳定
 *    捕获数量级回归；
 *  - **阈值按规模分档**：500 标签与 100 标签同阈值等于把偶发抖动放大成必然失败；
 *  - **附加正确性校验**：断言分区确实产出（防止「快是因为啥都没做」的假通过）。
 *
 * 明确**不在**本文件度量范围（单测环境无法如实测量，不臆造数字）：
 *  - chrome.tabs.detectLanguage 的真实 IPC 往返（依赖浏览器进程，单测里
 *    browser.* 是 wxt 的 fake-browser 替身）；
 *  - React 渲染与 DOM 提交耗时。
 */

/** 语言模式下真实窗口的语言分布（少量语种 + 大量标签）。 */
const LANGS = ['zh-CN', 'en', 'ja', 'en-US', 'de', 'fr', 'ko', 'ru'] as const;

/** 构造贴近真实规模的标签集：多域名 + 多语种。 */
function buildTabs(count: number, withLanguage = false): TabRecord[] {
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
    'react.dev'
  ];
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    windowId: 1,
    index,
    active: index === 0,
    pinned: false,
    incognito: false,
    url: 'https://' + sites[index % sites.length] + '/path/' + (index + 1) + '?ref=tabs',
    title: '文档 · ' + sites[index % sites.length] + ' #' + (index + 1),
    groupId: NO_GROUP,
    // 探测前为空（首帧全 unknown）；探测后按 LANGS 分布落值
    ...(withLanguage ? { language: LANGS[index % LANGS.length] } : {})
  }));
}

/** 语言模式派生：等价于 useSectionDerivation 在 groupMode='language' 下的调用。 */
function deriveLanguage(tabs: readonly TabRecord[]): ReturnType<typeof deriveSections> {
  return deriveSections({ tabs, groups: [], groupMode: 'language' });
}

/** 预热：承担模块初始化与 JIT，避免一次性成本计入测量。 */
function warmUp(tabs: readonly TabRecord[]): void {
  for (let i = 0; i < 3; i += 1) void deriveLanguage(tabs);
}

/** 多轮取中位数：抗单次毛刺，仍能捕获数量级回归。 */
function medianMs(run: () => void, rounds = 7): number {
  const samples: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

/** 探测结果写回（等价于 tabStore.setLanguages 的 map 开销）。 */
function applyLanguages(tabs: readonly TabRecord[]): TabRecord[] {
  return tabs.map((tab, index) => ({ ...tab, language: LANGS[index % LANGS.length] }));
}

describe('语言分组模式性能规格（100 / 500 标签）', () => {
  it('100 标签：单次派生中位数 < 100ms', () => {
    const tabs = buildTabs(100, true);
    warmUp(tabs);

    const sections = deriveLanguage(tabs);
    expect(sections.length).toBeGreaterThan(1);

    const ms = medianMs(() => void deriveLanguage(tabs));
    console.log('[perf] language derive 100 tabs: ' + ms.toFixed(3) + 'ms (median)');
    expect(ms).toBeLessThan(100);
  });

  it('500 标签：单次派生中位数 < 300ms', () => {
    const tabs = buildTabs(500, true);
    warmUp(tabs);

    const sections = deriveLanguage(tabs);
    expect(sections.length).toBeGreaterThan(1);

    const ms = medianMs(() => void deriveLanguage(tabs));
    console.log('[perf] language derive 500 tabs: ' + ms.toFixed(3) + 'ms (median)');
    expect(ms).toBeLessThan(300);
  });

  it('探测未回期间的首帧（全部 unknown）：500 标签派生中位数 < 300ms', () => {
    // 探测未回时 tab.language 为空 → 全部落 unknown → 只 1 个分区。
    // 这是打开面板的「首帧」形态，必须同样在阈值内，否则表现为开面板先卡一下。
    const tabs = buildTabs(500);
    warmUp(tabs);

    expect(deriveLanguage(tabs)).toHaveLength(1);

    const ms = medianMs(() => void deriveLanguage(tabs));
    console.log('[perf] language derive 500 tabs (all unknown): ' + ms.toFixed(3) + 'ms (median)');
    expect(ms).toBeLessThan(300);
  });

  it('100 / 500 标签：探测结果批量写回中位数 < 50ms', () => {
    // 逐条 set 会触发 N 轮派生；批量 set 只一轮 —— 这里量化「写回」这一步本身。
    const t100 = buildTabs(100);
    const t500 = buildTabs(500);
    warmUp(t100);

    const ms100 = medianMs(() => void applyLanguages(t100));
    const ms500 = medianMs(() => void applyLanguages(t500));
    console.log(
      '[perf] language writeback: 100 tabs ' +
        ms100.toFixed(3) +
        'ms / 500 tabs ' +
        ms500.toFixed(3) +
        'ms (median)'
    );

    expect(applyLanguages(t100)).toHaveLength(100);
    expect(ms100).toBeLessThan(50);
    expect(ms500).toBeLessThan(50);
  });

  it('500 标签：自动分组计划（planAutoGroups）中位数 < 300ms', () => {
    const tabs = buildTabs(500, true);
    warmUp(tabs);

    expect(planAutoGroups(deriveLanguage(tabs)).length).toBeGreaterThan(0);

    const ms = medianMs(() => void planAutoGroups(deriveLanguage(tabs)));
    console.log('[perf] language planAutoGroups 500 tabs: ' + ms.toFixed(3) + 'ms (median)');
    expect(ms).toBeLessThan(300);
  });

  it('500 标签：快速整理（planRegroup，语言模式）中位数 < 300ms', () => {
    const tabs = buildTabs(500, true);
    warmUp(tabs);

    expect(planRegroup({ tabs, groupMode: 'language' }).plans.length).toBeGreaterThan(0);

    const ms = medianMs(() => void planRegroup({ tabs, groupMode: 'language' }));
    console.log('[perf] language planRegroup 500 tabs: ' + ms.toFixed(3) + 'ms (median)');
    expect(ms).toBeLessThan(300);
  });
});
