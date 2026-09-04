import { describe, expect, it } from 'vitest';
import { inspectUrl, webComparisonKey } from '@/core/url/UrlInspector';

/**
 * URL 归一化等价类矩阵。
 *
 * 比较键是全应用重复判定、复用引擎、固定空间去重的**唯一口径**，
 * 此前各等价类散落在不同测试里，改一处不知道会碰坏哪条链路，
 * 这里集中列出「哪些 URL 算同一个、哪些不算」。
 *
 * 归一化范围：**只动 authority**（主机名小写 + 剥离默认端口），
 * 路径 / 查询 / 片段原样保留。下面每个用例都把这一契约钉死；
 * 标注「刻意不归一」的即已知且有意的行为，若将来要改，改的是这里，
 * 而不是在调用方各补一套 trim / 去参数逻辑。
 */

/** 同键判定：两边都能得到 web 比较键且相等。 */
function sameKey(a: string, b: string): boolean {
  const ka = webComparisonKey(a, undefined);
  const kb = webComparisonKey(b, undefined);
  return ka !== null && kb !== null && ka === kb;
}

describe('等价类矩阵：协议', () => {
  it('http 与 https 视为不同（安全上下文不同，不可互换）', () => {
    expect(sameKey('http://a.com/p', 'https://a.com/p')).toBe(false);
  });

  it('非 http(s) 一律拿不到 web 比较键', () => {
    for (const url of [
      'chrome://extensions/',
      'file:///tmp/x',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'about:blank',
      'not a url'
    ]) {
      expect(webComparisonKey(url, undefined)).toBeNull();
    }
  });
});

describe('等价类矩阵：主机名', () => {
  it('主机名大小写不敏感（用户输入与导入备份里常见大写写法）', () => {
    expect(sameKey('https://A.COM/p', 'https://a.com/p')).toBe(true);
    expect(webComparisonKey('HTTPS://A.COM/p', undefined)).toBe('https://a.com/p');
  });

  it('默认端口省略与显式写法等价（https:443 / http:80）', () => {
    expect(sameKey('https://a.com:443/p', 'https://a.com/p')).toBe(true);
    expect(sameKey('http://a.com:80/p', 'http://a.com/p')).toBe(true);
  });

  it('非默认端口视为不同', () => {
    expect(sameKey('https://a.com:8443/p', 'https://a.com/p')).toBe(false);
  });

  it('子域与裸域视为不同（站点归属不同）', () => {
    expect(sameKey('https://www.a.com/', 'https://a.com/')).toBe(false);
  });
});

describe('等价类矩阵：路径与查询', () => {
  it('【刻意不归一】尾斜杠：/a 与 /a/ 视为不同', () => {
    // Chrome 返回的 URL 恒带路径，实践中极少出现裸域无斜杠，故未做归一。
    expect(sameKey('https://a.com/a', 'https://a.com/a/')).toBe(false);
  });

  it('【刻意不归一】查询串参与比较（?utm 等追踪参数不剥离）', () => {
    expect(sameKey('https://a.com/p', 'https://a.com/p?utm_source=x')).toBe(false);
  });

  it('【刻意不归一】hash 片段参与比较', () => {
    expect(sameKey('https://a.com/p', 'https://a.com/p#top')).toBe(false);
  });

  it('查询串顺序不同视为不同', () => {
    expect(sameKey('https://a.com/p?a=1&b=2', 'https://a.com/p?b=2&a=1')).toBe(false);
  });
});

describe('等价类矩阵：导航中（pendingUrl）', () => {
  it('pending 为 web 时，比较键取 pending 而非已提交的 about:blank', () => {
    expect(webComparisonKey('about:blank', 'https://a.com/p')).toBe('https://a.com/p');
  });

  it('pending 与已提交为同一 URL 时键相同（导航完成后不会被判成重复）', () => {
    const pending = webComparisonKey('about:blank', 'https://a.com/p');
    const committed = webComparisonKey('https://a.com/p', undefined);
    expect(pending).toBe(committed);
  });

  it('pending 为内部页时不覆盖已提交的 web URL', () => {
    // 页面试图导航到 chrome:// 被拦：仍以已提交 URL 为准
    expect(webComparisonKey('https://a.com/p', 'chrome://extensions/')).toBe('https://a.com/p');
  });
});

describe('空白起始页的分类变体', () => {
  it('容忍尾斜杠与 hash 片段变体', () => {
    for (const url of ['about:blank', 'about:blank/', 'about:blank#blocked', 'chrome://newtab/']) {
      expect(inspectUrl(url, undefined).category).toBe('blank-start');
    }
  });
});
