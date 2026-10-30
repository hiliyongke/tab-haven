import { describe, expect, it } from 'vitest';
import { deriveSections, parseLangSiteKey } from '@/core/site/Sections';
import { NO_GROUP, type TabRecord } from '@/core/tab-types';

/**
 * 语言分组的哨兵归并。
 *
 * Chrome 对无法判定的语言可能返回 BCP-47 的 `und`，而本地无语言信息时用 `unknown`。
 * 两者不归并会分裂成两个分组，且其中一个标题直接显示「UND」。
 */

function tab(id: number, url: string, language?: string): TabRecord {
  return {
    id,
    windowId: 1,
    index: id,
    active: false,
    pinned: false,
    incognito: false,
    url,
    title: `Tab ${id}`,
    groupId: NO_GROUP,
    ...(language !== undefined ? { language } : {})
  };
}

describe('deriveSections 语言模式', () => {
  it('`und` 与「无语言信息」并入同一「未知语言」分组', () => {
    const sections = deriveSections({
      tabs: [tab(1, 'https://a.example.com/', 'und'), tab(2, 'https://b.example.com/')],
      groups: [],
      groupMode: 'language',
      threshold: 1
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('未知语言');
    expect(sections[0]?.tabs.map((item) => item.id).sort()).toEqual([1, 2]);
  });

  it('语言分区键不与合法的单标签 hostname 冲突', () => {
    expect(parseLangSiteKey('lang-en')).toBeUndefined();
    expect(parseLangSiteKey('lang:en')).toBe('en');
    expect(parseLangSiteKey('lang:80')).toBeUndefined();

    const sections = deriveSections({
      tabs: [tab(1, 'https://lang-en/', 'en'), tab(2, 'https://lang-en/', 'en')],
      groups: [],
      groupMode: 'language',
      threshold: 1
    });
    expect(sections[0]).toMatchObject({ kind: 'site', siteKey: 'lang:en' });
  });

  it('已知语言码按标签展开，不落到未知分组', () => {
    const sections = deriveSections({
      tabs: [tab(1, 'https://a.example.com/', 'zh-CN'), tab(2, 'https://b.example.com/', 'en')],
      groups: [],
      groupMode: 'language',
      threshold: 1
    });

    expect(sections.map((section) => section.title)).toEqual(['English', '中文（简体）']);
  });
});
