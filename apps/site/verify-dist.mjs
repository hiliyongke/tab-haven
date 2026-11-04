import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const siteDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = fileURLToPath(new URL('../../', import.meta.url));

function read(path) {
  return readFileSync(path, 'utf8');
}

if (!existsSync(`${siteDir}dist/index.html`) || !existsSync(`${siteDir}dist/en/index.html`)) {
  throw new Error('[site] dist 缺少中英文预渲染页面');
}

const extensionPackage = JSON.parse(read(`${rootDir}apps/extension/package.json`));
const expectedDownload = `tabs-${extensionPackage.version}.zip`;
const download = `${siteDir}dist/download/${expectedDownload}`;
const html = read(`${siteDir}dist/index.html`);
const english = read(`${siteDir}dist/en/index.html`);

if (/\p{Script=Han}/u.test(english.replace(/简体中文/g, ''))) {
  throw new Error('[site] 英文产物仍含中文');
}
if (!existsSync(download)) {
  throw new Error(`[site] dist 缺少当前版本下载包 ${expectedDownload}`);
}
if (!html.includes(`/download/${expectedDownload}`)) {
  throw new Error(`[site] 下载包存在但 HTML 未指向 ${expectedDownload}`);
}

/** 未配置域名时 build.mjs 会刻意不生成 SEO 产物，此时只校验页面与下载包。 */
const siteUrl = process.env.TABS_SITE_URL ?? '';
if (siteUrl) {
  const origin = new URL(siteUrl).origin;
  const sitemapPath = `${siteDir}dist/sitemap.xml`;
  const robotsPath = `${siteDir}dist/robots.txt`;
  if (!existsSync(sitemapPath)) {
    throw new Error('[site] 配置 TABS_SITE_URL 后产物缺少 sitemap.xml');
  }
  if (!existsSync(robotsPath)) {
    throw new Error('[site] 配置 TABS_SITE_URL 后产物缺少 robots.txt');
  }
  const sitemap = read(sitemapPath);
  const robots = read(robotsPath);
  for (const page of [`${origin}/`, `${origin}/en/`]) {
    if (!sitemap.includes(`<loc>${page}</loc>`)) {
      throw new Error(`[site] sitemap.xml 缺少 ${page}`);
    }
  }
  if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) {
    throw new Error('[site] robots.txt 未指向本站 sitemap.xml');
  }
  for (const [name, content, canonical] of [
    ['中文', html, `${origin}/`],
    ['英文', english, `${origin}/en/`]
  ]) {
    if (!content.includes(`rel="canonical" href="${canonical}"`)) {
      throw new Error(`[site] ${name}页 canonical 不是 ${canonical}`);
    }
    if (content.includes('canonical / hreflang / JSON-LD omitted')) {
      throw new Error(`[site] ${name}页仍带「未配置域名」占位注释`);
    }
  }
  console.log(`[site] 正式产物校验通过（canonical / sitemap / robots，${origin}）`);
}

console.log(`[site] 产物校验通过（下载包 ${expectedDownload}）`);
