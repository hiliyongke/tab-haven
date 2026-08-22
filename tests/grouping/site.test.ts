import { describe, expect, it } from 'vitest';
import { siteIdentity } from '@/core/grouping/site';

/**
 * 契约用例（docs/ARCHITECTURE.md 第 8 章）：
 * 域名归组的基线兼容性红线，Tabstead 行为不回归。
 */
describe('siteIdentity', () => {
  it('非 http/https 协议返回 null', () => {
    expect(siteIdentity('chrome://newtab/')).toBeNull();
    expect(siteIdentity('about:blank')).toBeNull();
  });

  it('去 www 前缀并取注册域', () => {
    const id = siteIdentity('https://www.example.com/docs/page');
    expect(id?.key).toBe('example.com');
    expect(id?.subdomain).toBe('');
  });

  it('托管公共后缀取三级域（github.io 基线场景）', () => {
    const id = siteIdentity('https://user.github.io/repo/');
    expect(id?.key).toBe('user.github.io');
  });

  it('托管公共后缀清单全覆盖（vercel.app / netlify.app 等）', () => {
    expect(siteIdentity('https://my.vercel.app/x')?.key).toBe('my.vercel.app');
    expect(siteIdentity('https://site.netlify.app/x')?.key).toBe('site.netlify.app');
    expect(siteIdentity('https://foo.blogspot.com/x')?.key).toBe('foo.blogspot.com');
    expect(siteIdentity('https://a.notion.site/x')?.key).toBe('a.notion.site');
  });

  it('托管域本身（无三级子域）不误伤', () => {
    // github.io 本体（无用户子域）应保持 github.io 而非空
    expect(siteIdentity('https://github.io/')?.key).toBe('github.io');
  });

  it('国家复合后缀取三级域（.com.cn 基线场景）', () => {
    const id = siteIdentity('https://news.tencent.com.cn/a');
    expect(id?.key).toBe('tencent.com.cn');
  });

  it('localhost 带端口分组（不同端口不同组）', () => {
    const a = siteIdentity('http://localhost:3000/');
    const b = siteIdentity('http://localhost:8080/');
    expect(a?.key).toBe('localhost:3000');
    expect(b?.key).toBe('localhost:8080');
    expect(a?.key).not.toBe(b?.key);
  });

  it('多级域名归组：子域归入注册域（FR-D3.1）', () => {
    const cloud = siteIdentity('https://cloud.tencent.com/products');
    const news = siteIdentity('https://news.tencent.com/');
    expect(cloud?.key).toBe('tencent.com');
    expect(news?.key).toBe('tencent.com');
    expect(cloud?.subdomain).toBe('cloud');
  });
});
