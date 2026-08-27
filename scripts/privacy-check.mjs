#!/usr/bin/env node
/**
 * 隐私回归检查（FR-D10.5）：权限冻结 + 零网络请求 + 无第三方遥测。
 *
 * 运行：pnpm check:privacy
 * 前置：先执行 pnpm build（读取 .output/chrome-mv3/manifest.json）
 *
 * 与 UI 令牌守卫不同，本检查依赖构建产物，因此保持为独立 CLI 而非 Vitest 用例，
 * 以便在 `pnpm build` 之后单独执行。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');
const MANIFEST = join(ROOT, '.output', 'chrome-mv3', 'manifest.json');

/** 权限冻结清单（PRD 附录 A）。新增权限须先走 PRD 变更。 */
const ALLOWED_PERMISSIONS = new Set([
  'sidePanel',
  'tabs',
  'tabGroups',
  'storage',
  'commands',
  'alarms', // 用户开启自动休眠后周期检查
  'contextMenus', // 右键菜单快捷操作（休眠/固定/入文件夹/按站点搜索）
  'omnibox', // 地址栏 th 命令搜索标签/固定条目/文件夹
  'sessions', // 撤销历史面板恢复浏览器最近关闭
  'bookmarks', // 用户主动的固定文件夹 ↔ 书签互转
  'notifications', // 自动休眠完成的本机通知
  'declarativeNetRequest', // 开发者禁缓存：按用户站点规则改写响应头（默认关闭，配套 host 权限走 optional）
  'scripting' // 开发者禁缓存：向命中站点注入醒目警示条
]);

/** 禁止出现的网络通道调用。 */
const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\b/,
  /<script[^>]+src=["']https?:\/\//
];

const SCANNABLE = new Set(['.ts', '.tsx', '.html', '.js']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCANNABLE.has(full.slice(full.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

const issues = [];

if (!existsSync(MANIFEST)) {
  console.error('未找到构建产物，请先运行 pnpm build');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const permissions = new Set(manifest.permissions ?? []);
const unexpected = [...permissions].filter((p) => !ALLOWED_PERMISSIONS.has(p));
if (unexpected.length > 0) issues.push(`未授权权限: ${unexpected.sort().join(', ')}`);

for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const pattern of NETWORK_PATTERNS) {
      if (pattern.test(line)) {
        issues.push(`发现网络调用: ${relative(ROOT, file)}:${i + 1} ${line.trim().slice(0, 80)}`);
      }
    }
  });
}

if (issues.length > 0) {
  console.error('隐私回归检查失败:');
  for (const issue of issues) console.error(`  ✗ ${issue}`);
  process.exit(1);
}

const sourceCount = walk(SRC).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).length;
console.log(
  `隐私回归检查通过: 权限 ${[...permissions].sort().join(', ')}，` +
    `网络通道调用 0，源码文件 ${sourceCount} 个`
);
