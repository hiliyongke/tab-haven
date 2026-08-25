import { describe, expect, it } from 'vitest';
import { classifyHost, isIpHost, isLocalHost } from '@/core/site/HostRules';

/**
 * 主机归类（PRD 附录 C-4）：
 *  - localhost / *.localhost → local；
 *  - IPv4（段值 0-255）/ IPv6（含冒号）→ ip；
 *  - 托管公共后缀（github.io 等）→ public；
 *  - 其余 → domain。
 */
describe('HostRules', () => {
  it('localhost 与 *.localhost 归类 local', () => {
    expect(classifyHost('localhost').kind).toBe('local');
    expect(classifyHost('app.localhost').kind).toBe('local');
    expect(isLocalHost('notlocalhost.com')).toBe(false);
  });

  it('合法 IPv4 / IPv6 归类 ip', () => {
    expect(isIpHost('127.0.0.1')).toBe(true);
    expect(isIpHost('192.168.1.1')).toBe(true);
    expect(isIpHost('255.255.255.255')).toBe(true);
    expect(isIpHost('::1')).toBe(true);
    expect(isIpHost('[::1]')).toBe(true);
    expect(classifyHost('10.0.0.1').kind).toBe('ip');
  });

  it('非法 IPv4（段值超界）不当 ip：WHATWG URL 把它当域名解析', () => {
    expect(isIpHost('999.1.2.3')).toBe(false);
    expect(isIpHost('256.0.0.1')).toBe(false);
    expect(classifyHost('999.1.2.3').kind).toBe('domain');
  });

  it('托管公共后缀命中 public 并带后缀', () => {
    expect(classifyHost('user.github.io')).toEqual({ kind: 'public', hostedSuffix: 'github.io' });
    expect(classifyHost('github.io').kind).toBe('domain'); // 裸后缀本身（labels ≤ 2）按域名处理
  });

  it('普通域名归类 domain', () => {
    expect(classifyHost('example.com').kind).toBe('domain');
    expect(classifyHost('sub.example.co.uk').kind).toBe('domain');
  });
});
