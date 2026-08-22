/**
 * 官网构建编排（独立工程，不参与扩展的 `pnpm build` / `pnpm check`）。
 *
 * 顺序不可调换：
 *   1. 拷 zip —— 必须在**客户端构建之前**，public/ 才会被打进 dist/download/；
 *   2. 客户端构建 —— 产出 dist/index.html 模板与 assets（先做，避免被 SSR 构建清空）；
 *   3. SSR 构建 —— 产出 dist/.ssr 渲染函数（emptyOutDir: false，不能清掉上一步）；
 *   4. 预渲染 —— 按语言产出 /index.html 与 /en/index.html；
 *   5. robots.txt / sitemap.xml；
 *   6. 自检：外部链接、网络 API、英文页残留中文。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { LANGUAGES, SITE_URL } from './site.config.ts';
import { applyTemplate, renderHead } from './lib/html.mjs';

const siteDir = fileURLToPath(new URL('.', import.meta.url));
// 官网在 apps/site 下，仓库根要再上一级（'..' 只会到 apps/）。
const repoRoot = resolve(siteDir, '../..');
// 扩展包目录：版本号与上架包都在那里（工作区根 package.json 是纯编排，没有版本号）。
const extensionDir = join(repoRoot, 'apps', 'extension');
const distDir = join(siteDir, 'dist');
const configFile = join(siteDir, 'vite.config.ts');

/** 版本号以扩展包的 package.json 为单一事实来源，官网不另行维护一份。 */
function readVersion() {
  const pkg = JSON.parse(readFileSync(join(extensionDir, 'package.json'), 'utf8'));
  return String(pkg.version);
}

/** 把扩展的上架包拷进官网 public/：下载走同域，零第三方外链。 */
function stageDownloadZip(version) {
  const outputDir = join(extensionDir, '.output');
  const targetDir = join(siteDir, 'public', 'download');
  const target = join(targetDir, `tabs-${version}.zip`);

  if (!existsSync(outputDir)) {
    console.warn('[site] 未找到 .output/，跳过下载包拷贝：请先跑 `pnpm build && pnpm zip`');
    return null;
  }
  // 按版本号精确匹配，而不是「取最新」：.output/ 里可能同时有 chrome 与 edge 两份包，
  // 按 mtime 取会挑错；按名字取则能挡住「改了版本号却没重新打包」的错配。
  const zips = readdirSync(outputDir)
    .filter((name) => name.startsWith(`tabs-${version}-`) || name === `tabs-${version}.zip`)
    .sort();
  const chosen = zips[0];

  if (!chosen) {
    console.warn(
      `[site] .output/ 下没有 tabs-${version}-*.zip，跳过拷贝 —— 下载按钮将指向不存在的地址。请先跑 \`pnpm zip\``
    );
    return null;
  }
  // 清空再拷：public/download 不在 dist 的清空范围内，上一轮构建留在这里的包会被一直发布出去。
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(join(outputDir, chosen), target);
  console.log(`[site] 下载包：${chosen} → apps/site/public/download/tabs-${version}.zip`);
  return `/download/tabs-${version}.zip`;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** 零外链自检：官网继承扩展的产品宪法，不得出现任何第三方请求。 */
function assertNoExternalRequests() {
  const files = walk(distDir).filter((file) => /\.(html|js|css|svg|xml|txt)$/.test(file));
  // 白名单都是「纯标识符、永不真正发起请求」的命名空间，不是可访问的端点：
  // schema.org = JSON-LD 的 @context，w3.org = SVG/XML 命名空间，
  // sitemaps.org = sitemap.xml 的命名空间（漏了它，配好 SITE_URL 后自检必红）。
  const allowedHosts = ['schema.org', 'www.w3.org', 'www.sitemaps.org'];
  if (SITE_URL) allowedHosts.push(SITE_URL.replace(/^https?:\/\//, ''));

  const external = [];
  const networkApis = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/https?:\/\/([^\s"'<>)]+)/g)) {
      // 先截断到 host 再**全等**比较：startsWith 会把 schema.org.evil.com 也放行。
      const host = match[1].split('/')[0];
      if (!allowedHosts.includes(host)) external.push(`${file}: ${host}`);
    }
    for (const match of text.matchAll(
      /\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/g
    )) {
      networkApis.push(`${file}: ${match[1]}`);
    }
  }
  return { external, networkApis };
}

/**
 * 英文页残留中文自检。
 *
 * 为什么必须有这条：`i18n-kit lint` 只扫扩展的 src/，官网漏写 t() **没有任何守卫**
 * 会报警，表现就是英文站静默露出中文。这里把「英文产物不得含汉字」变成会红的断言。
 */
function findHanInEnglish(htmlPath) {
  // 豁免项由 LANGUAGES 推导：语言名一律以该语言自身写法呈现（英文站也写「简体中文」），
  // 这是唯一的合法残留 —— 写成常量表就是两处维护同一事实，加语言时容易漏。
  const whitelist = LANGUAGES.filter((lang) => /\p{Script=Han}/u.test(lang.label)).map(
    (lang) => lang.label
  );
  let text = readFileSync(htmlPath, 'utf8');
  for (const term of whitelist) text = text.split(term).join('');
  const hits = [];
  for (const match of text.matchAll(/[^\s<>]{0,20}\p{Script=Han}[^\s<>]{0,20}/gu)) {
    hits.push(match[0]);
  }
  return hits;
}

async function main() {
  const version = readVersion();
  // 页脚年份由构建期注入：写死年份每年都会过期一次，而这是唯一一处会暴露的日期。
  const year = String(new Date().getFullYear());
  const downloadPath = stageDownloadZip(version);

  console.log('[site] 客户端构建…');
  await build({ configFile, logLevel: 'warn' });

  console.log('[site] SSR 构建…');
  // 中间产物落在 node_modules/.cache 而不是 dist/：dist/ 是要整体传上去的目录，
  // 混进渲染脚本等于把构建产物一起发布（且 emptyOutDir 会与客户端构建互相清空）。
  const ssrOutDir = join(siteDir, 'node_modules', '.cache', 'tabs-site-ssr');
  await build({
    configFile,
    logLevel: 'warn',
    build: { ssr: 'src/entry-server.tsx', outDir: ssrOutDir, emptyOutDir: true }
  });

  const ssrEntry = walk(ssrOutDir).find((file) => file.endsWith('entry-server.js'));
  if (!ssrEntry) throw new Error('SSR 产物缺失：未找到 entry-server.js');
  const { render } = await import(pathToFileURL(ssrEntry).href);

  const template = readFileSync(join(distDir, 'index.html'), 'utf8');
  console.log('[site] 预渲染…');
  for (const lang of LANGUAGES) {
    const result = render(lang.code, { version, year });
    const html = applyTemplate(template, {
      lang,
      head: renderHead({ lang, title: result.title, description: result.description, version }),
      body: result.html
    });
    // 占位符必须被真正替换掉：若哪天构建链路剥掉了 HTML 注释，SEO 标签会**无声消失**
    // 而后面的自检依然全绿（它只查外链与中文，不查标签在不在）。
    for (const marker of ['<!--SITE_HEAD-->', '<!--SITE_APP-->']) {
      if (html.includes(marker))
        throw new Error(`${lang.htmlLang} 页面的占位符 ${marker} 未被替换`);
    }
    const outPath =
      lang.path === '/' ? join(distDir, 'index.html') : join(distDir, lang.path, 'index.html');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
    console.log(`[site] ${lang.htmlLang} → ${outPath.replace(`${siteDir}/`, '')}`);
  }

  writeFileSync(
    join(distDir, 'robots.txt'),
    SITE_URL
      ? `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`
      : 'User-agent: *\nAllow: /\n'
  );
  if (SITE_URL) {
    const urls = LANGUAGES.map(
      (lang) =>
        `  <url><loc>${SITE_URL}${lang.path}</loc><xhtml:link rel="alternate" hreflang="${lang.htmlLang}" href="${SITE_URL}${lang.path}"/></url>`
    );
    writeFileSync(
      join(distDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
    );
  } else {
    console.warn('[site] SITE_URL 未配置：已跳过 sitemap.xml 与 canonical/hreflang/JSON-LD');
  }

  const { external, networkApis } = assertNoExternalRequests();
  const hanHits = findHanInEnglish(join(distDir, 'en', 'index.html'));

  if (external.length || networkApis.length || hanHits.length) {
    for (const hit of external) console.error(`[site] 外链：${hit}`);
    for (const hit of networkApis) console.error(`[site] 网络 API：${hit}`);
    for (const hit of hanHits) console.error(`[site] 英文页残留中文：${hit}`);
    throw new Error('官网自检未通过（零外链 / 零网络 / 英文页无残留中文）');
  }

  console.log(
    `[site] 自检通过：零外链、零网络 API、英文页无残留中文。下载包 ${downloadPath ?? '（未拷贝）'}`
  );
}

await main();
