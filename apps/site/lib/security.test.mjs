import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { findExternalUrls, findNetworkApis, normalizeSiteUrl } from './external-requests.mjs';
import { serializeJsonLd } from './html.mjs';
import { assertReleaseSiteUrl } from '../site.config.ts';
import { LOCAL_PREVIEW, toDownloadHref } from './download.mjs';

const siteDir = fileURLToPath(new URL('../', import.meta.url));

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

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

  it('release SITE_URL 只接受无凭据、无路径的 http(s) 根 URL', () => {
    assert.equal(normalizeSiteUrl('https://tabs.example'), 'https://tabs.example/');
    assert.equal(assertReleaseSiteUrl('https://tabs.example'), 'https://tabs.example/');
    assert.equal(assertReleaseSiteUrl('http://localhost:8080'), 'http://localhost:8080/');

    for (const invalid of [
      '',
      'ftp://tabs.example',
      'https://user:pass@tabs.example',
      'https://tabs.example/',
      'https://tabs.example/en/',
      'https://tabs.example/?utm=1',
      'https://tabs.example/#top',
      'not-a-url'
    ]) {
      assert.throws(() => assertReleaseSiteUrl(invalid), /SITE_URL/);
    }
  });

  it('CTA 弱文本在浅色与深色主题都满足 AA 对比度', () => {
    const sections = readFileSync(`${siteDir}src/styles/sections.css`, 'utf8');
    const tokens = readFileSync(`${siteDir}src/styles/tokens.css`, 'utf8');
    const ctaNote = sections.match(/\.cta-note\s*\{[^}]*color:\s*var\((--c-gray-\d+)\)/)?.[1];
    assert.equal(ctaNote, '--c-gray-500');

    const light = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const dark =
      tokens.match(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
    for (const [name, block, surface] of [
      ['light', light, '#ffffff'],
      ['dark', dark, '#282e2b']
    ]) {
      const color = block.match(/--c-gray-500:\s*(#[0-9a-f]{6})/i)?.[1];
      const background = block.match(/--surface:\s*(#[0-9a-f]{6})/i)?.[1] ?? surface;
      assert.ok(color, `${name} 缺少 gray-500 token`);
      assert.ok(
        contrastRatio(color, background) >= 4.5,
        `${name} CTA 对比度 ${contrastRatio(color, background).toFixed(2)}:1`
      );
    }
  });

  it('所有下载入口都带 download，skip 模式由构建上下文关闭链接', () => {
    const sourceFiles = [
      'src/components/SiteNav.tsx',
      'src/sections/Hero.tsx',
      'src/sections/QuickStart.tsx',
      'src/sections/CtaBand.tsx'
    ];
    const app = readFileSync(`${siteDir}src/App.tsx`, 'utf8');
    const entryServer = readFileSync(`${siteDir}src/entry-server.tsx`, 'utf8');
    const build = readFileSync(`${siteDir}build.mjs`, 'utf8');

    for (const file of sourceFiles) {
      const source = readFileSync(`${siteDir}${file}`, 'utf8');
      assert.match(source, /href=\{downloadHref\}\s+download/, `${file} 缺少 download 属性`);
      assert.match(source, /downloadHref\s*===\s*null/, `${file} 未处理 skip 模式`);
    }
    assert.match(app, /downloadHref\?: string \| null/);
    assert.match(app, /t\('仅本地预览，下载包未随此构建发布'\)/);
    assert.match(entryServer, /downloadHref=\{ctx\.downloadHref\}/);
    assert.match(build, /return LOCAL_PREVIEW/);
    assert.match(build, /if \(release && !downloadAvailable\)/);
    assert.match(build, /const downloadAvailable = downloadPath !== LOCAL_PREVIEW/);
    assert.match(build, /release 构建不得使用 SITE_SKIP_ZIP=1/);
    assert.match(build, /downloadHref: toDownloadHref\(downloadPath, version\)/);
    assert.match(build, /downloadAvailable && !existsSync\(join\(distDir, downloadPath\)\)/);
  });

  it('skip 标记关闭下载 href，成功路径保留同域 ZIP 地址', () => {
    assert.equal(LOCAL_PREVIEW, 'local-preview');
    assert.equal(toDownloadHref(LOCAL_PREVIEW, '1.2.3'), null);
    assert.equal(toDownloadHref('/download/tabs-1.2.3.zip', '1.2.3'), '/download/tabs-1.2.3.zip');
    assert.equal(toDownloadHref(undefined, '1.2.3'), '/download/tabs-1.2.3.zip');
  });

  it('无脚本 Demo 不暴露 tab 语义，重复点击锚点仍可展开详情', () => {
    const demo = readFileSync(`${siteDir}src/sections/Demo.tsx`, 'utf8');
    const client = readFileSync(`${siteDir}src/client.ts`, 'utf8');
    const css = readFileSync(`${siteDir}src/styles/sections.css`, 'utf8');
    const componentsCss = readFileSync(`${siteDir}src/styles/components.css`, 'utf8');
    const footer = readFileSync(`${siteDir}src/components/SiteFooter.tsx`, 'utf8');

    assert.doesNotMatch(demo, /\srole="tab(list|panel)?"/);
    assert.doesNotMatch(demo, /aria-selected=/);
    assert.doesNotMatch(demo, /tabIndex=\{0\}/);
    assert.match(demo, /data-role="tablist"/);
    assert.match(demo, /data-role="tabpanel"/);
    assert.match(css, /\.demo-enhanced-only\s*\{\s*display: none;/);
    assert.match(client, /setAttribute\('role', 'tab'\)/);
    assert.match(client, /document\.addEventListener\('click'/);
    assert.match(componentsCss, /:target/);
    assert.match(footer, /#permissions-content/);
    assert.match(footer, /#shortcuts-content/);
  });

  it('较旧浏览器与高对比度模式下仍有可读、可达的视觉降级', () => {
    const componentsCss = readFileSync(`${siteDir}src/styles/components.css`, 'utf8');
    const baseCss = readFileSync(`${siteDir}src/styles/base.css`, 'utf8');
    const client = readFileSync(`${siteDir}src/client.ts`, 'utf8');

    assert.match(componentsCss, /\.site-nav\s*\{[^}]*background:\s*var\(--surface\)/);
    assert.match(componentsCss, /@supports \(color: color-mix/);
    assert.match(componentsCss, /@supports \(backdrop-filter/);
    assert.match(baseCss, /@media \(forced-colors: active\)/);
    assert.match(baseCss, /outline: 2px solid Highlight/);
    assert.match(client, /classList\.add\('js'\)/);
    assert.match(client, /if \(target instanceof HTMLDetailsElement\) target\.open = true/);
  });

  it('官网门禁先准备扩展 ZIP，发布构建仍拒绝缺包', () => {
    const rootPackage = JSON.parse(readFileSync(`${siteDir}../../package.json`, 'utf8'));
    const build = readFileSync(`${siteDir}build.mjs`, 'utf8');

    assert.match(rootPackage.scripts['site:check'], /pnpm zip && pnpm --filter site check/);
    assert.match(build, /if \(release && !downloadAvailable\)/);
    assert.match(build, /release 构建不得使用 SITE_SKIP_ZIP=1/);
  });
});
