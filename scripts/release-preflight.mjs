import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const extensionPackage = JSON.parse(readFileSync(`${root}apps/extension/package.json`, 'utf8'));
const siteConfig = readFileSync(`${root}apps/site/site.config.ts`, 'utf8');
const storeListing = readFileSync(`${root}CHROMEWEBSTORE.md`, 'utf8');
const changelog = readFileSync(`${root}CHANGELOG.md`, 'utf8');
const securityPolicy = readFileSync(`${root}SECURITY.md`, 'utf8');

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[release] 缺少发布配置 ${name}`);
  return value;
}

function requireHttpUrl(name) {
  const value = requireEnv(name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[release] ${name} 不是合法 URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`[release] ${name} 必须是无凭据的 http(s) URL`);
  }
  return value;
}

const version = extensionPackage.version;
if (!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z-]+)?$/.test(version)) {
  throw new Error(`[release] package version 不是正式版本号：${version}`);
}

const ref = process.env.GITHUB_REF ?? '';
const tag = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : '';
const requestedVersion = process.env.TABS_RELEASE_VERSION ?? '';
if (tag && tag !== `v${version}`) {
  throw new Error(`[release] tag ${tag} 与扩展版本 v${version} 不一致`);
}
if (!tag && requestedVersion && requestedVersion !== version) {
  throw new Error(
    `[release] workflow_dispatch 版本 ${requestedVersion} 与扩展版本 ${version} 不一致`
  );
}

const siteUrl = requireHttpUrl('TABS_SITE_URL');
const normalizedSiteUrl = new URL(siteUrl);
if (normalizedSiteUrl.href !== `${normalizedSiteUrl.origin}/`) {
  throw new Error('[release] TABS_SITE_URL 必须是不带路径、查询参数或片段的根 URL');
}
if (/[\s<>"'`]/.test(siteUrl) || siteUrl !== normalizedSiteUrl.origin) {
  throw new Error('[release] TABS_SITE_URL 必须是无凭据的规范化 http(s) 根 URL');
}
if (!siteConfig.includes('TABS_SITE_URL')) {
  throw new Error(
    '[release] site.config.ts 未从 TABS_SITE_URL 读取 SITE_URL，发布环境变量不会生效'
  );
}

requireEnv('TABS_PUBLISHER_NAME');
const contactEmail = requireEnv('TABS_CONTACT_EMAIL');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
  throw new Error('[release] TABS_CONTACT_EMAIL 不是有效邮箱');
}
requireHttpUrl('TABS_SUPPORT_URL');
requireHttpUrl('TABS_PRIVACY_POLICY_URL');

if (/<发布|待填写|TODO|<[^>]*@example/.test(storeListing)) {
  throw new Error('[release] CHROMEWEBSTORE.md 仍有未完成的占位文案');
}
if (!changelog.includes(`## [${version}]`)) {
  throw new Error(`[release] CHANGELOG.md 缺少 [${version}] 正式版本段落`);
}
if (!storeListing.includes(`| ${version}`)) {
  throw new Error(`[release] CHROMEWEBSTORE.md 版本历史缺少 ${version}`);
}
if (!securityPolicy.includes('https://github.com/hiliyongke/tab-haven/security/advisories/new')) {
  throw new Error('[release] SECURITY.md 缺少绝对地址的私有漏洞报告入口');
}

console.log(`[release] ${version} 发布前置检查通过`);
