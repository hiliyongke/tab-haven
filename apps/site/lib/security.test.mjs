import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findExternalUrls, findNetworkApis } from './external-requests.mjs';
import { serializeJsonLd } from './html.mjs';

describe('站点构建安全检查', () => {
  it('检测带引号或空格的 fetch 与全部受禁网络 API', () => {
    const source = [
      'fetch("/api")',
      "fetch ( '/api' )",
      "fetch?.('/api')",
      "(0, fetch)('/api')",
      'new XMLHttpRequest()',
      'navigator.sendBeacon("/log")',
      'new WebSocket("wss://example.invalid")',
      'new EventSource("/events")'
    ].join('\n');

    assert.deepEqual(findNetworkApis(source), [
      'fetch(',
      'fetch (',
      'fetch?.(',
      '(0, fetch)(',
      'XMLHttpRequest',
      'sendBeacon',
      'WebSocket',
      'EventSource'
    ]);
    assert.deepEqual(findNetworkApis('fetcher("/api")'), []);
  });

  it('检测无点主机名的外部请求', () => {
    assert.deepEqual(findExternalUrls('http://localhost:5174/ http://intranet/ //printer'), [
      'localhost:5174',
      'intranet',
      'printer'
    ]);
  });

  it('只放行准确的命名空间引用，不放行同域其他路径或相似域名', () => {
    const knownNamespaces =
      '<script type="application/ld+json">{"@context":"https://schema.org"}</script>' +
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
      'xmlns:xhtml="http://www.w3.org/1999/xhtml"></urlset>';
    assert.deepEqual(findExternalUrls(knownNamespaces), []);

    const rejectedUrls = 'https://schema.org/script.js https://www.w3.org.evil/a';
    assert.deepEqual(findExternalUrls(rejectedUrls), ['schema.org', 'www.w3.org.evil']);
  });

  it('只按 SITE_URL 的精确 origin 放行站点自身 URL', () => {
    assert.deepEqual(
      findExternalUrls(
        'https://tabs.example/en/ https://tabs.example.evil.invalid/',
        'https://tabs.example'
      ),
      ['tabs.example.evil.invalid']
    );
  });

  it('JSON-LD 序列化会阻止内嵌脚本提前闭合', () => {
    const value = { description: '</script><script>alert(1)</script>' };
    const serialized = serializeJsonLd(value);

    assert.equal(/<\/script/i.test(serialized), false);
    assert.deepEqual(JSON.parse(serialized), value);
  });
});
