import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const extensionPackage = JSON.parse(readFileSync(`${root}apps/extension/package.json`, 'utf8'));
const changelog = readFileSync(`${root}CHANGELOG.md`, 'utf8');
const heading = `## [${extensionPackage.version}]`;
const start = changelog.indexOf(heading);
if (start === -1) throw new Error(`[release] CHANGELOG.md 缺少 ${heading}`);
const next = changelog.indexOf('\n## [', start + heading.length);
const section = changelog.slice(start + heading.length, next === -1 ? undefined : next).trim();
writeFileSync(
  `${root}release-notes.md`,
  `# Tabs ${extensionPackage.version}\n\n${section}\n\n完整隐私说明见发布站点的隐私政策与仓库 PRIVACY.md。\n`
);
