import { describe, expect, it } from 'vitest';
import { siteResolver } from '@/core/site/SiteResolver';

/**
 * 行为规格（PRD 附录 C-4 / FR-D3.1）：
 *  - 站点身份归一化：去 www、注册域归组；
 *  - 托管公共后缀（github.io 等）取三级域；
 *  - 国家复合后缀（.com.cn）取三级域（PSL 权威）；
 *  - 本地/IP 主机带端口整体为键（不同端口不同组）；
 *  - 多级域名子域归入注册域。
 */
describe('SiteResolver', () => {
  it('非 http(s) 协议不可解析', () => {
    expect(siteResolver.resolve('chrome://newtab/')).toBeNull();
    expect(siteResolver.resolve('about:blank')).toBeNull();
  });

  it('去 www 并取注册域', () => {
    const key = siteResolver.resolve('https://www.example.com/docs/page');
    expect(key?.value).toBe('example.com');
    expect(key?.subdomain).toBe('');
  });

  it('托管公共后缀取三级域（github.io）', () => {
    const key = siteResolver.resolve('https://user.github.io/repo/');
    expect(key?.value).toBe('user.github.io');
  });

  it('国家复合后缀取三级域（.com.cn）', () => {
    const key = siteResolver.resolve('https://news.tencent.com.cn/a');
    expect(key?.value).toBe('tencent.com.cn');
  });

  it('本地主机带端口为键：不同端口不同组', () => {
    const a = siteResolver.resolve('http://localhost:3000/');
    const b = siteResolver.resolve('http://localhost:8080/');
    expect(a?.value).toBe('localhost:3000');
    expect(b?.value).toBe('localhost:8080');
    expect(a?.value).not.toBe(b?.value);
  });

  it('子域归入注册域（FR-D3.1）', () => {
    const cloud = siteResolver.resolve('https://cloud.tencent.com/products');
    const news = siteResolver.resolve('https://news.tencent.com/');
    expect(cloud?.value).toBe('tencent.com');
    expect(news?.value).toBe('tencent.com');
    expect(cloud?.subdomain).toBe('cloud');
  });

  it('托管域本体（无用户子域）不误伤', () => {
    expect(siteResolver.resolve('https://github.io/')?.value).toBe('github.io');
  });
});
