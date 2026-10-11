import { describe, expect, it } from 'vitest';
import { normalizeHostname } from '@/core/url/hostname';

/**
 * 行为规格：主机名归一化（`core/url/hostname`）—— 全应用唯一口径。
 *
 * 这是「同一站点」判定的地基：固定空间去重（PinIdentity）、站点归组
 * （SiteResolver）、免缓存规则（noCachePattern）都吃这一份结果。三处归一
 * 口径一旦漂移，同一站点会在不同功能里被判成两个（聚合漏判 / 固定项重复留存）。
 *
 * 规则只有三条，按序叠加：小写 → 去开头 `www.` → 去尾点。
 * 顺序有意义：先小写才拦得住 `WWW.` 这类大写前缀（下方用例钉死）。
 * 标注「刻意不归一」的是已知且有意的行为，若将来要改，改的是这里 + 所有调用方，
 * 而不是在调用方各补一套 trim / 解码逻辑。
 */
describe('normalizeHostname', () => {
  describe('等价类：大小写', () => {
    it('大写主机小写化（DNS 不区分大小写，比较键必须唯一）', () => {
      // Given 用户手输 / 导入备份里的大写写法
      // When 归一化
      // Then 得到小写唯一形态
      expect(normalizeHostname('EXAMPLE.COM')).toBe('example.com');
      expect(normalizeHostname('Example.Com')).toBe('example.com');
    });

    it('大小写写法不同的同一主机归一后相等（聚合与去重的前提）', () => {
      // Given 三种大小写变体
      // When 各自归一化
      // Then 三者同键
      expect(normalizeHostname('A.COM')).toBe(normalizeHostname('a.com'));
      expect(normalizeHostname('WWW.A.COM')).toBe(normalizeHostname('www.a.com'));
    });
  });

  describe('等价类：www 前缀', () => {
    it('剥离 www 前缀（www 不是身份，www.a.com 与 a.com 是同一站点）', () => {
      expect(normalizeHostname('www.a.com')).toBe('a.com');
      expect(normalizeHostname('WWW.A.COM')).toBe('a.com');
    });

    it('【刻意不归一】www 只剥开头一处（www.www.a.com → www.a.com）', () => {
      // 非循环剥离：真实 DNS 里双 www 是独立子域，不做猜测式循环。
      expect(normalizeHostname('www.www.a.com')).toBe('www.a.com');
    });

    it('不在开头的 www 原样保留（wwwa.com / awww.com / my.www.a.com）', () => {
      expect(normalizeHostname('wwwa.com')).toBe('wwwa.com');
      expect(normalizeHostname('awww.com')).toBe('awww.com');
      expect(normalizeHostname('my.www.a.com')).toBe('my.www.a.com');
    });

    it('裸 www（无点）不是前缀，原样保留', () => {
      expect(normalizeHostname('www')).toBe('www');
    });

    it('输入恰为「www.」时归为空串（调用方以空串判定「不可解析」）', () => {
      expect(normalizeHostname('www.')).toBe('');
    });
  });

  describe('等价类：尾点（FQDN）', () => {
    it('剥离单个尾点（a.com. 是合法 FQDN，与 a.com 同义）', () => {
      expect(normalizeHostname('a.com.')).toBe('a.com');
    });

    it('【刻意不归一】多个尾点只剥一个（a.com.. → a.com.）', () => {
      // 正则无 /g：非循环。多点尾缀不是合法 FQDN，不做猜测式清理。
      expect(normalizeHostname('a.com..')).toBe('a.com.');
    });

    it('不在末尾的点不影响（a..com 原样保留）', () => {
      expect(normalizeHostname('a..com')).toBe('a..com');
    });

    it('纯点输入：单点归为空串，多点保留剩余点', () => {
      expect(normalizeHostname('.')).toBe('');
      expect(normalizeHostname('...')).toBe('..');
    });
  });

  describe('等价类：组合与幂等', () => {
    it('三条规则叠加生效：WWW.Example.COM. → example.com', () => {
      expect(normalizeHostname('WWW.Example.COM.')).toBe('example.com');
    });

    it('幂等：对已归一的输入再归一结果不变（重复落库/重复解析安全）', () => {
      for (const host of ['example.com', 'a.com.', 'www.a.com', 'WWW.A.COM.', '192.168.1.1']) {
        const once = normalizeHostname(host);
        expect(normalizeHostname(once)).toBe(once);
      }
    });
  });

  describe('等价类：端口 / IP / 本地主机', () => {
    it('端口原样保留（本地/IP 场景下「主机:端口」才是身份，不同端口不同组）', () => {
      expect(normalizeHostname('LOCALHOST:3000')).toBe('localhost:3000');
      expect(normalizeHostname('localhost:3000')).toBe('localhost:3000');
    });

    it('IPv4 原样保留', () => {
      expect(normalizeHostname('192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeHostname('127.0.0.1:8080')).toBe('127.0.0.1:8080');
    });

    it('IPv6 字面量小写化（含字母时仍保持幂等）', () => {
      expect(normalizeHostname('[FE80::1]')).toBe('[fe80::1]');
      expect(normalizeHostname('[::1]')).toBe('[::1]');
    });
  });

  describe('等价类：IDN（punycode / 中文域名）', () => {
    it('punycode 形态原样保留（比较键保持前后稳定，不在此处解码）', () => {
      expect(normalizeHostname('xn--fiq228c.cn')).toBe('xn--fiq228c.cn');
    });

    it('大写 punycode 小写化（xn-- 标签同样大小写不敏感）', () => {
      expect(normalizeHostname('XN--FIQ228C.CN')).toBe('xn--fiq228c.cn');
    });

    it('Unicode 主机不被转码（解码属 domainToUnicode 的职责）', () => {
      expect(normalizeHostname('中文.cn')).toBe('中文.cn');
    });

    it('中文域名的大小写 / www / 尾点同样归一', () => {
      expect(normalizeHostname('WWW.中文.CN.')).toBe('中文.cn');
    });
  });

  describe('等价类：边界与坏数据', () => {
    it('空串返回空串（调用方以空串判定不可解析，不抛异常）', () => {
      expect(normalizeHostname('')).toBe('');
    });

    it('【刻意不归一】首尾空白不裁剪（trim 不是本函数的职责）', () => {
      // 上游（new URL / 导入解析）负责裁剪；此处若顺手 trim，
      // 会让「带空格的坏数据」静默变成合法键。
      expect(normalizeHostname(' a.com ')).toBe(' a.com ');
    });

    it('含非法字符（下划线 / 斜杠 / 空格 / 协议前缀）原样透传且不抛异常', () => {
      for (const bad of ['a_b.com', 'a.com/x', 'a b.com', 'http://a.com', 'a..b..c']) {
        expect(() => normalizeHostname(bad)).not.toThrow();
        expect(normalizeHostname(bad)).toBe(bad.toLowerCase());
      }
    });

    it('超长主机名不截断（长度与内容保持，DNS 上限由上游负责）', () => {
      // Given 远超 DNS 253 字节上限的主机
      const long = `${'a'.repeat(300)}.com`;
      // When 归一化
      const result = normalizeHostname(long);
      // Then 仅小写化，不截断、不报错
      expect(result).toBe(long);
      expect(result).toHaveLength(long.length);
    });
  });
});
