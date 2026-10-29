import { describe, expect, it } from 'vitest';
import { isOneTabTooLarge, parseOneTab } from '@/core/snapshot/oneTabImport';
import { SNAPSHOT_TABS_LIMIT } from '@/core/schema/models';

/**
 * 行为规格：OneTab 文本导入（`core/snapshot/oneTabImport.ts`）。
 *
 * 它把用户粘贴的整段文本变成快照条目。三类失效都见过：把非 http(s) 协议
 * 当成可恢复条目、超 1MB 静默返回空、超过条数上限静默截断——后两者都会让
 * 界面给出与事实不符的回执。
 */

describe('parseOneTab', () => {
  it('解析裸 URL 与「URL - 标题」两种行', () => {
    const { tabs } = parseOneTab(
      ['https://a.example.com/', 'https://b.example.com/ - B 标题'].join('\n')
    );
    expect(tabs.map((tab) => tab.url)).toEqual([
      'https://a.example.com/',
      'https://b.example.com/'
    ]);
    expect(tabs[1]?.title).toBe('B 标题');
  });

  it('只收 http(s)：其他协议不是可恢复条目', () => {
    expect(parseOneTab('javascript:alert(1)\nchrome://settings').tabs).toEqual([]);
  });

  it('超过 1MB 整体拒收，且能与「没有网址」区分开', () => {
    const tooLarge = `https://a.example.com/\n${'x'.repeat(1024 * 1024)}`;
    expect(isOneTabTooLarge(tooLarge)).toBe(true);
    expect(parseOneTab(tooLarge)).toEqual({ tabs: [], tooLarge: true, truncated: false });

    const noUrl = '这段文字里一个网址都没有';
    expect(isOneTabTooLarge(noUrl)).toBe(false);
    expect(parseOneTab(noUrl)).toEqual({ tabs: [], tooLarge: false, truncated: false });
  });

  it('有效条目超过上限时截断，并把 truncated 交回调用方', () => {
    const lines = Array.from(
      { length: SNAPSHOT_TABS_LIMIT + 1 },
      (_, i) => `https://e${i}.example.com/`
    );
    const result = parseOneTab(lines.join('\n'));
    expect(result.tabs).toHaveLength(SNAPSHOT_TABS_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.tooLarge).toBe(false);
  });

  it('忽略 // 注释行与空行', () => {
    expect(parseOneTab('// 导出说明\n\nhttps://c.example.com/').tabs.map((tab) => tab.url)).toEqual(
      ['https://c.example.com/']
    );
  });
});
