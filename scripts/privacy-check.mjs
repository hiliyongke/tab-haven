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
const OUT = join(ROOT, '.output', 'chrome-mv3');
const MANIFEST = join(OUT, 'manifest.json');
const PRIVACY_DOC = join(ROOT, 'PRIVACY.md');

/** 权限冻结清单（PRD 附录 A）。新增权限须先走 PRD 变更。 */
const ALLOWED_PERMISSIONS = new Set([
  'sidePanel',
  'tabs',
  'tabGroups',
  'storage',
  'commands',
  'alarms', // 用户开启自动休眠后周期检查
  'contextMenus', // 右键菜单快捷操作（休眠/固定/入文件夹/按站点搜索）
  'omnibox', // 地址栏 t 命令搜索标签/固定条目/文件夹
  'sessions', // 撤销历史面板恢复浏览器最近关闭
  'bookmarks', // 用户主动的固定文件夹 ↔ 书签互转
  'notifications', // 自动休眠完成的本机通知
  'declarativeNetRequest' // 开发者禁缓存：按用户站点规则改写响应头（默认关闭，配套 host 权限走 optional）
]);

/**
 * 可选主机权限冻结清单（按需请求，未开启功能时安装不出现全站权限警告）。
 * 与 permissions 同样需要走 PRD 变更才能放开。
 */
const ALLOWED_OPTIONAL_HOST_PERMISSIONS = new Set(['<all_urls>']);

/**
 * 禁止出现的网络通道调用。
 * 覆盖直接调用与常见间接形式（EventSource / 远程 import / 图片打点 / 外部连接）。
 */
const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\b/,
  /\bEventSource\b/,
  // 远程资源引用（img / script / iframe 的 src 赋值或 JSX 属性）。
  // 只匹配「字面量远程 URL」：`new Image()` 配 data: URL 取色是本机操作，不在此列。
  /\bsrc\s*=\s*["'`]https?:\/\//,
  /\bimport\s*\(\s*['"]https?:\/\//,
  /\bruntime\.connect\s*\(/,
  /<script[^>]+src=["']https?:\/\//
];

/**
 * 图标渲染闸门（P1-4）：`src/ui/common/Favicon.tsx` 是唯一会渲染外部地址的地方。
 *
 * 折中口径：浏览器/站点自身提供的图标仍然渲染（否则图标大面积消失），但必须保留
 * 三道闸门——scheme 白名单、渲染前判定、`no-referrer`。门禁只拦「放开」：
 * 白名单里多出 http(s)/data:image 之外的 scheme、删掉判定、删掉 no-referrer、
 * 或新增一个不受白名单约束的动态 src，都会失败。
 */
const FAVICON_FILE = join(SRC, 'ui', 'common', 'Favicon.tsx');
/** 白名单允许出现的 scheme（与 PRIVACY.md §1 的图标承诺一致）。 */
const FAVICON_ALLOWED_SCHEMES = new Set(['http', 'https', 'data']);

/** 存储键字面量：项目内所有存储键统一以 `tabs.` 前缀命名。 */
const STORAGE_KEY_LITERAL = /['"](tabs\.[a-zA-Z0-9._-]+)['"]/g;
/** i18n 键同样以 `tabs.` 开头（`t('tabs.xxx')`），不是存储键，整行跳过。 */
const I18N_CALL = /\bt\(\s*['"]tabs\./;
/** 注释行（含 JSDoc）里提到的键名不是声明，跳过。 */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;
/** 非存储用途的 `tabs.` 字面量：导出文件格式标识。 */
const NON_STORAGE_KEYS = new Set(['tabs.export']);

/** 静态资源引用（img src 等）本身不是扩展发起的网络通道，单独放行。 */
const NETWORK_EXEMPT = /^\s*(?:\/\/|\*|\/\*)/;

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

/**
 * PRIVACY.md 第 2 节的权限表是本检查的**第二事实源**。
 *
 * 此前本脚本只比对脚本内硬编码的 ALLOWED_PERMISSIONS，导致 README / CONTRIBUTING /
 * PRIVACY.md 三处宣称的「新增权限须同步 PRIVACY.md，否则门禁失败」并不成立——
 * 改了 wxt.config.ts 而不动文档，门禁依然全绿。这里把文档解析为真实比对源，
 * 让「承诺」与「强制」对齐：源码清单与文档清单必须逐项一致。
 */
/**
 * PRIVACY.md 第 3 节的存储键清单是本检查的**第二事实源**（与权限表同款双向比对）。
 *
 * 此前「新增存储键须同步 PRIVACY.md」只是一句承诺：改了源码而忘了文档，门禁全绿。
 * 这里把文档 §3 解析为真实比对源，让源码键集合与文档键集合必须逐项一致。
 */
function readDocumentedStorageKeys() {
  if (!existsSync(PRIVACY_DOC)) return null;
  const lines = readFileSync(PRIVACY_DOC, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^##\s*3\./.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end).join('\n');
  const found = new Set();
  for (const match of section.matchAll(/`(tabs\.[a-zA-Z0-9._-]+)`/g)) found.add(match[1]);
  return found;
}

/** 扫描源码里的存储键常量（键 → 首次出现位置）。 */
function readSourceStorageKeys() {
  const found = new Map();
  for (const file of walk(SRC)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (COMMENT_LINE.test(line) || I18N_CALL.test(line)) return;
      for (const match of line.matchAll(STORAGE_KEY_LITERAL)) {
        const key = match[1];
        if (NON_STORAGE_KEYS.has(key)) continue;
        if (!found.has(key)) found.set(key, `${relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  return found;
}

/**
 * 图标渲染闸门校验：渲染路径不接受「白名单之外的任意地址」，且不带 Referer。
 * 动态 `src={src}` 本身无法从正则上判定取值，故改为断言闸门三件套仍在位，
 * 并禁止出现第二个（不受同一判定约束的）src 渲染点。
 */
function checkFaviconGuard() {
  if (!existsSync(FAVICON_FILE)) {
    issues.push('缺少 src/ui/common/Favicon.tsx，图标渲染闸门无法校验');
    return;
  }
  const text = readFileSync(FAVICON_FILE, 'utf8');

  const whitelist = text.match(/const\s+SAFE_FAVICON_SRC\s*=\s*\/([^\n]+?)\/([a-z]*)\s*;/);
  if (!whitelist) {
    issues.push('Favicon.tsx 缺少 SAFE_FAVICON_SRC 白名单（渲染外部图标必须过白名单）');
  } else {
    const body = whitelist[1];
    const schemes = [...body.matchAll(/([a-z][a-z0-9+.-]*)\s*:/gi)].map((m) => m[1].toLowerCase());
    const illegal = [...new Set(schemes)].filter((scheme) => !FAVICON_ALLOWED_SCHEMES.has(scheme));
    if (illegal.length > 0) {
      issues.push(
        `Favicon.tsx 图标白名单放开了未授权的 scheme: ${illegal.sort().join(', ')}` +
          '（仅允许 http(s) 与 data:image/）'
      );
    }
    // 正则里的 `/` 常被转义成 `\/`，故分隔符前的反斜杠可选。
    if (schemes.includes('data') && !/data\s*:\s*image\s*\\?\//i.test(body)) {
      issues.push('Favicon.tsx 图标白名单中的 data: 必须是 data:image/ 前缀');
    }
  }

  if (!/isSafeFaviconSrc\(src\)/.test(text)) {
    issues.push('Favicon.tsx 渲染前缺少 isSafeFaviconSrc(src) 白名单判定');
  }
  if (!/referrerPolicy\s*=\s*["']no-referrer["']/.test(text)) {
    issues.push('Favicon.tsx 的 <img> 缺少 referrerPolicy="no-referrer"（会向站点泄露来源）');
  }
  const srcAttrs = [...text.matchAll(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g)].map((m) =>
    m[0].replace(/\s+/g, ' ')
  );
  const guarded = srcAttrs.filter((attr) => /^src\s*=\s*\{src\}$/.test(attr));
  if (guarded.length !== srcAttrs.length || srcAttrs.length === 0) {
    issues.push(
      `Favicon.tsx 出现不受白名单判定的 src 渲染点: ${srcAttrs.join(' | ') || '（无）'}` +
        '（只允许 src={src}）'
    );
  }
  if (/dangerouslySetInnerHTML|\binnerHTML\b/.test(text)) {
    issues.push('Favicon.tsx 出现 innerHTML 渲染路径');
  }
  // 对外口径：图标请求必须在 PRIVACY.md 明示（否则「零出站」表述失真）。
  if (existsSync(PRIVACY_DOC) && !/favicon/i.test(readFileSync(PRIVACY_DOC, 'utf8'))) {
    issues.push('PRIVACY.md 未明示站点图标请求（favicon），与「零出站网络请求」表述冲突');
  }
}

function readDocumentedPermissions() {
  if (!existsSync(PRIVACY_DOC)) return null;
  const text = readFileSync(PRIVACY_DOC, 'utf8');
  const found = new Set();
  for (const line of text.split('\n')) {
    const row = line.match(/^\|\s*`([a-zA-Z]+)`\s*\|/);
    if (row) found.add(row[1]);
  }
  return found;
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

// 权限清单 ↔ PRIVACY.md 双向比对（任一方向漏改都失败）。
const documented = readDocumentedPermissions();
if (documented === null) {
  issues.push('未找到 PRIVACY.md，无法校验权限清单与文档是否一致');
} else {
  const undocumented = [...permissions].filter((p) => !documented.has(p));
  const staleDoc = [...documented].filter((p) => !permissions.has(p));
  if (undocumented.length > 0) {
    issues.push(`权限已声明但未在 PRIVACY.md 记录: ${undocumented.sort().join(', ')}`);
  }
  if (staleDoc.length > 0) {
    issues.push(`PRIVACY.md 记录了 manifest 中已不存在的权限: ${staleDoc.sort().join(', ')}`);
  }
}

// 主机权限同样进冻结清单：`<all_urls>` 是本项目最敏感的一项声明，
// 只查 permissions 会让它完全游离在守卫之外。
const hostPermissions = new Set([
  ...(manifest.host_permissions ?? []),
  ...(manifest.optional_host_permissions ?? [])
]);
const unexpectedHosts = [...hostPermissions].filter(
  (p) => !ALLOWED_OPTIONAL_HOST_PERMISSIONS.has(p)
);
if (unexpectedHosts.length > 0) {
  issues.push(`未授权主机权限: ${unexpectedHosts.sort().join(', ')}`);
}

// 存储键 ↔ PRIVACY.md 第 3 节双向比对（任一方向漏改都失败）。
const sourceKeys = readSourceStorageKeys();
const documentedKeys = readDocumentedStorageKeys();
if (documentedKeys === null) {
  issues.push('未找到 PRIVACY.md 第 3 节，无法校验存储键清单');
} else {
  const undocumentedKeys = [...sourceKeys.keys()].filter((key) => !documentedKeys.has(key));
  const staleKeys = [...documentedKeys].filter((key) => !sourceKeys.has(key));
  if (undocumentedKeys.length > 0) {
    issues.push(
      `存储键已在源码声明但未在 PRIVACY.md 第 3 节记录: ${undocumentedKeys.sort().join(', ')}` +
        `（出处: ${undocumentedKeys.map((key) => sourceKeys.get(key)).join(', ')}）`
    );
  }
  if (staleKeys.length > 0) {
    issues.push(`PRIVACY.md 第 3 节记录了源码中已不存在的存储键: ${staleKeys.sort().join(', ')}`);
  }
}

// 图标渲染闸门（唯一会渲染外部地址的路径）。
checkFaviconGuard();

/** 单文件最多报告的网络命中数：压缩产物是单行，不设上限会被一条规则刷满输出。 */
const MAX_HITS_PER_FILE = 5;

function scanFiles(files, label) {
  let hits = 0;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let fileHits = 0;
    lines.forEach((line, i) => {
      if (fileHits >= MAX_HITS_PER_FILE) return;
      if (NETWORK_EXEMPT.test(line)) return;
      for (const pattern of NETWORK_PATTERNS) {
        if (pattern.test(line)) {
          issues.push(
            `发现网络调用（${label}）: ${relative(ROOT, file)}:${i + 1} ${line.trim().slice(0, 80)}`
          );
          fileHits += 1;
          hits += 1;
          break;
        }
      }
    });
  }
  return hits;
}

scanFiles(walk(SRC), '源码');

// 构建产物同样要扫：只扫 src/ 时，第三方依赖（pinyin-pro / tldts / fuzzysort 等）
// 打进 bundle 后的网络调用完全不可见，而「零出站网络请求」是面向**最终产物**
// 的承诺——用户安装的是 .output，不是 src。
if (existsSync(OUT)) {
  scanFiles(
    walk(OUT).filter((f) => f.endsWith('.js')),
    '构建产物'
  );
}

if (issues.length > 0) {
  console.error('隐私回归检查失败:');
  for (const issue of issues) console.error(`  ✗ ${issue}`);
  process.exit(1);
}

const sourceCount = walk(SRC).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).length;
const bundleCount = existsSync(OUT) ? walk(OUT).filter((f) => f.endsWith('.js')).length : 0;
console.log(
  `隐私回归检查通过: 权限 ${[...permissions].sort().join(', ')}，` +
    `主机权限 ${[...hostPermissions].sort().join(', ')}，` +
    `网络通道调用 0（源码 ${sourceCount} 个 + 产物 ${bundleCount} 个），` +
    `权限清单与 PRIVACY.md 一致，` +
    `存储键 ${sourceKeys.size} 个与 PRIVACY.md 第 3 节一致，图标渲染闸门在位`
);
