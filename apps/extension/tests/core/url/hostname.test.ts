import { describe, expect, it } from 'vitest';
import { normalizeHostname, normalizeWhitelistHost } from '@/core/url/hostname';

/**
 * 主机名归一化行为规格：转小写、移除一个开头的 `www.` 与一个尾点；
 * 按用例保留端口、IP 地址、IDN 形式与首尾空白等输入特征。
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
      // 多个尾点仅移除一个。
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
      // 主机名归一化保留首尾空白，由调用方负责输入解析与裁剪。
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

/** 休眠白名单行为规格：粘贴的 URL 归一为可匹配主机名，无效输入归一为空串。 */
describe('normalizeWhitelistHost', () => {
  it('Given 粘贴整串 http(s) URL When 归一化 Then 只留 hostname', () => {
    expect(normalizeWhitelistHost('https://www.a.com/some/path')).toBe('a.com');
    expect(normalizeWhitelistHost('HTTPS://WWW.Example.com/x')).toBe('example.com');
  });

  it('Given 非 http(s) scheme When 归一化 Then 保留主机名', () => {
    // 去除非 http(s) scheme 后保留主机名部分。
    expect(normalizeWhitelistHost('ftp://a.com')).toBe('a.com');
  });

  it('Given 不可建标签的 scheme / 裸 scheme 残留 When 归一化 Then 判空丢弃', () => {
    expect(normalizeWhitelistHost('javascript:alert(1)')).toBe('');
    expect(normalizeWhitelistHost('ftp:')).toBe('');
  });

  it('Given 带端口的主机 When 归一化 Then 保留 host:port（本地开发站点是合法白名单项）', () => {
    expect(normalizeWhitelistHost('localhost:3000')).toBe('localhost:3000');
    expect(normalizeWhitelistHost('http://localhost:3000/')).toBe('localhost:3000');
  });

  it('Given 带端口的 IPv6 字面量 When 归一化 Then 保留 [IPv6]:port（方括号内冒号属地址本身）', () => {
    // 方括号内的冒号属于 IPv6 地址，端口位于右方括号之后。
    expect(normalizeWhitelistHost('[::1]:3000')).toBe('[::1]:3000');
    expect(normalizeWhitelistHost('https://[::1]:3000/')).toBe('[::1]:3000');
  });

  it('Given 不带端口的 IPv6 字面量 When 归一化 Then 保留 [IPv6]（与 SiteResolver 的站点键同口径）', () => {
    // 不带端口的 IPv6 主机名保留为方括号形式 `[::1]`。
    expect(normalizeWhitelistHost('[::1]')).toBe('[::1]');
    expect(normalizeWhitelistHost('https://[::1]/')).toBe('[::1]');
    expect(normalizeWhitelistHost('[fe80::1]')).toBe('[fe80::1]');
  });

  it('Given 越界或非数字端口 When 归一化 Then 判空丢弃', () => {
    expect(normalizeWhitelistHost('a.com:0')).toBe('');
    expect(normalizeWhitelistHost('a.com:99999')).toBe('');
    expect(normalizeWhitelistHost('a.com:8080:9090')).toBe('');
  });

  it('Given 凭据串 When 归一化 Then 判空丢弃（不是 hostname）', () => {
    expect(normalizeWhitelistHost('user:pass@a.com')).toBe('');
    expect(normalizeWhitelistHost('user@a.com')).toBe('');
  });

  it('Given 手输的裸 IPv6（无方括号）When 归一化 Then 补回方括号而非判空', () => {
    // 裸 IPv6 输入归一为带方括号的地址形式。
    expect(normalizeWhitelistHost('::1')).toBe('[::1]');
    expect(normalizeWhitelistHost('fe80::1')).toBe('[fe80::1]');
  });

  it('Given 前导零端口 / 端口前的尾点 When 归一化 Then 与 URL 解析结果同形', () => {
    // 端口去除前导零，主机尾点与端口一并归一。
    expect(normalizeWhitelistHost('a.com:080')).toBe('a.com:80');
    expect(normalizeWhitelistHost('a.com.:80')).toBe('a.com:80');
    expect(normalizeWhitelistHost('WWW.A.com.:080')).toBe('a.com:80');
  });

  it('Given 含空白的 ASCII 主机名 When 归一化 Then 判空丢弃', () => {
    // 含空白的主机名不能解析为 hostname，不进入白名单。
    expect(normalizeWhitelistHost('a b.com')).toBe('');
    expect(normalizeWhitelistHost('a.com b')).toBe('');
    expect(normalizeWhitelistHost('https://a b.com/x')).toBe('');
  });

  it('Given 形式特殊的 ASCII 主机名 When 归一化 Then 保留归一化结果', () => {
    // `a..com`、`-a.com` 与 `a_b.com` 按原样保留。
    expect(normalizeWhitelistHost('a..com')).toBe('a..com');
    expect(normalizeWhitelistHost('-a.com')).toBe('-a.com');
    expect(normalizeWhitelistHost('a_b.com')).toBe('a_b.com');
  });

  it('Given 中文域名（IDN）When 归一化 Then 落盘为 punycode（匹配端拿到的是 punycode）', () => {
    // 白名单 hostname 归一为浏览器 URL 使用的 punycode 形式。
    expect(normalizeWhitelistHost('中文.cn')).toBe('xn--fiq228c.cn');
    expect(normalizeWhitelistHost('https://www.中文.cn/x')).toBe('xn--fiq228c.cn');
  });
});
