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
console.log(`[site] 产物校验通过（下载包 ${expectedDownload}）`);
