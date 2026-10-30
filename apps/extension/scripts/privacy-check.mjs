#!/usr/bin/env node
/**
 * 隐私检查（FR-D10.5）：权限清单 + 零网络请求 + 无第三方遥测。
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
import { findCspViolations } from './csp-policy.ts';

// 本脚本随扩展包住在 apps/extension/scripts/ 下，故 ROOT 就是扩展包目录：
// src / public / .output 三个相对路径因此无需改动。
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** 工作区根：PRIVACY.md 与 packages/ 是产品级/跨包资产，不随扩展包走。 */
const WORKSPACE_ROOT = resolve(ROOT, '..', '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, '.output', 'chrome-mv3');
const PUBLIC_DIR = join(ROOT, 'public');
/** 工作区包（packages/*）：随包发布的运行时代码，与 src/ 同级需要进门禁。 */
const PACKAGES = join(WORKSPACE_ROOT, 'packages');
const MANIFEST = join(OUT, 'manifest.json');
const PRIVACY_DOC = join(WORKSPACE_ROOT, 'PRIVACY.md');

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
  'declarativeNetRequest', // 开发者禁缓存：按用户站点规则改写响应头（默认关闭，配套 host 权限走 optional）
  // 站点图标走浏览器本地通道（chrome-extension://<id>/_favicon/）。加它反而让
  // 「零出站网络请求」从「有一个例外」变成「零例外」：图标不再由扩展页向站点取。
  'favicon'
]);

/**
 * 可选主机权限冻结清单（按需请求，未开启功能时安装不出现全站权限警告）。
 * 与 permissions 同样需要走 PRD 变更才能放开。
 */
const ALLOWED_OPTIONAL_HOST_PERMISSIONS = new Set(['<all_urls>']);

/**
 * 可选权限（`optional_permissions`）冻结清单。
 *
 * 该字段单独核验，避免其权限项遗漏在普通权限与主机权限检查之外。
 * 当前集合为空；按需申请的网站权限通过 `optional_host_permissions` 声明。
 */
const ALLOWED_OPTIONAL_PERMISSIONS = new Set();

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
  /<script[^>]+src=["']https?:\/\//,
  // 静态页（public/*.html、产物 HTML）的外引资源：HTML 与 .js 一样在门禁内，
  // 因为 PRIVACY.md 明确承诺卸载挽留页「无任何外链」——承诺必须有校验。
  /<link[^>]+href=["']https?:\/\//,
  /@import\s+["']https?:\/\//,
  /\burl\(\s*["']?https?:\/\//
];

/**
 * 图标渲染闸门（P1-4）：图标地址由 `src/platform/favicon.ts` 构造，
 * `src/ui/common/Favicon.tsx` 是唯一渲染站点图标的地方（组件只消费字符串）。
 *
 * 口径（**零例外**）：图标只允许来自浏览器自己的 favicon 通道
 * `chrome-extension://<id>/_favicon/`。渲染站点自身的图标地址会引入第三方出站
 * 请求，且在鉴权站点上会被 302 一路带到登录页再跳回来
 * （一次约 25 跳，最终 ERR_TOO_MANY_REDIRECTS）。
 *
 * 门禁只拦「放开」：删掉通道构造、改用任何 http(s) 图标地址、绕过 platform 直连
 * 浏览器 API、或新增第二个不受 `buildFaviconSrc` 约束的 src 渲染点，都会失败。
 */
const FAVICON_FILE = join(SRC, 'ui', 'common', 'Favicon.tsx');
/** 图标地址构造层（platform）：`browser.runtime.id` 只应出现在这里。 */
const FAVICON_SRC_FILE = join(SRC, 'platform', 'favicon.ts');

/**
 * 存储键字面量：项目内存储键统一使用 `tabs.` 或 `tabs:` 前缀。
 * 两种形式都纳入与 PRIVACY.md §3 的双向比对，覆盖数据键与主题镜像键。
 */
const STORAGE_KEY_LITERAL = /['"](tabs[.:][a-zA-Z0-9._-]+)['"]/g;
/** i18n 键同样以 `tabs.` 开头（`t('tabs.xxx')`），不是存储键，整行跳过。 */
const I18N_CALL = /\bt\(\s*['"]tabs\./;
/** 注释行（含 JSDoc）里提到的键名不是声明，跳过。 */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;
/** 非存储用途的 `tabs.` 字面量：导出文件格式标识。 */
const NON_STORAGE_KEYS = new Set(['tabs.export']);
/**
 * 非存储用途的 `tabs:` 字面量：`src/ui/**` 中的 DOM 自定义事件名（如 `LOCATE_TAB_EVENT`）。
 * 按常量名 `_EVENT` 后缀识别，目录位置变化不影响分类；此类名称不落盘。
 */
const DOM_EVENT_LITERAL = /\b[A-Z][A-Z0-9_]*_EVENT\s*=\s*['"]tabs:/;
/**
 * 存储键的声明范围：整个 `src/`，包括主题镜像键与 platform 层键。
 * DOM 自定义事件名由 `DOM_EVENT_LITERAL` 按 `_EVENT` 命名约定排除；
 * 其余 `tabs[.:]` 字面量均参与源码与隐私说明的双向比对。
 */
const STORAGE_KEY_SCOPE = SRC;

/**
 * 源码里的注释行（`//` / `/*` / `* `）：示例与说明中的 URL 不是真实调用，放行。
 *
 * **只对源码生效**：`public/*.html` 与 CSS 是被保护对象本身（它们随包分发、
 * 由浏览器直接解析），若连 HTML / CSS 的注释也一并放行，注释里写一句
 * `<link href="https://…">` 或 `@import url(https://…)` 就能永久豁免 —— 对它们
 * 必须连注释一起扫（`NETWORK_PATTERNS` 里那两条 CSS 规则只有在 CSS 文件真正
 * 进入扫描范围时才可能命中，再给 CSS 开注释豁免会让它们再次形同虚设）。
 */
const NETWORK_EXEMPT_CODE = /^\s*(?:\/\/|\*|\/\*)/;
/** 静态页（HTML）与样式（CSS）：不豁免注释行，见上。空行与纯空白行仍跳过。 */
const NETWORK_EXEMPT_HTML = /^\s*$/;

const SCANNABLE = new Set(['.ts', '.tsx', '.html', '.js', '.css']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    // 依赖目录不进门禁：packages/*/node_modules 是工作区包的依赖，
    // 扫它等于把第三方库误判为本产品源码。
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCANNABLE.has(full.slice(full.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

/**
 * PRIVACY.md 第 3 节的存储键清单是本检查的**第二事实源**（与权限表同款双向比对）。
 *
 * 「新增存储键须同步 PRIVACY.md」不能只是一句承诺：只比对源码会让「改了源码忘了
 * 文档」的门禁照样全绿。这里把文档 §3 解析为真实比对源，源码键集合与文档键集合
 * 必须逐项一致。
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
  for (const match of section.matchAll(/`(tabs[.:][a-zA-Z0-9._-]+)`/g)) found.add(match[1]);
  return found;
}

/** 扫描源码里的存储键常量（键 → 首次出现位置）。 */
function readSourceStorageKeys() {
  const found = new Map();
  for (const file of walk(STORAGE_KEY_SCOPE)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (COMMENT_LINE.test(line) || I18N_CALL.test(line) || DOM_EVENT_LITERAL.test(line)) return;
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
  if (!existsSync(FAVICON_SRC_FILE)) {
    issues.push('缺少 src/platform/favicon.ts，图标地址构造闸门无法校验');
    return;
  }
  if (!existsSync(FAVICON_FILE)) {
    issues.push('缺少 src/ui/common/Favicon.tsx，图标渲染闸门无法校验');
    return;
  }
  const text = readFileSync(FAVICON_FILE, 'utf8');
  const srcText = readFileSync(FAVICON_SRC_FILE, 'utf8');

  // ① 必须走浏览器自己的 favicon 通道（本产品唯一允许的图标来源）。
  //    通道地址构造在 platform（那里才允许碰 browser.runtime.id）。
  if (!/_favicon/.test(srcText)) {
    issues.push('favicon.ts 未使用浏览器 favicon 通道（_favicon）——图标不得来自任何第三方');
  }
  if (!/chrome-extension:\/\//.test(srcText)) {
    issues.push('favicon.ts 图标地址必须是 chrome-extension:// 本扩展通道');
  }
  if (!/export\s+function\s+buildFaviconSrc\s*\(/.test(srcText)) {
    issues.push('favicon.ts 必须导出 buildFaviconSrc(pageUrl) 供 UI 消费');
  }
  // ② 渲染的 src 必须由该通道构造函数产出，不能是任意外来地址；
  //    且 UI 不得自己拼接通道（否则分层与闸门同时失效）。
  if (!/const\s+src\s*=\s*buildFaviconSrc\s*\(/.test(text)) {
    issues.push('Favicon.tsx 的 src 必须来自 buildFaviconSrc(pageUrl)（禁止渲染任意图标地址）');
  }
  if (!/from\s+'@\/platform\/favicon'/.test(text)) {
    issues.push('Favicon.tsx 必须从 @/platform/favicon 取图标地址（UI 不得直连浏览器 API）');
  }
  if (/\bbrowser\.(runtime|tabs|storage)\b/.test(text)) {
    issues.push('Favicon.tsx 出现浏览器 API 直连——图标地址构造必须留在 platform 层');
  }
  // ③ 图标渲染组件不包含 http(s) 图标白名单判定。
  if (/SAFE_FAVICON_SRC|isSafeFaviconSrc/.test(text)) {
    issues.push('Favicon.tsx 出现 http(s) 图标白名单判定；图标只能来自浏览器 favicon 通道');
  }
  // ④ 渲染点唯一且受同一约束：多出一个 src 就是新增一条图标渲染路径。
  const srcAttrs = [...text.matchAll(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g)].map((m) =>
    m[0].replace(/\s+/g, ' ')
  );
  const guarded = srcAttrs.filter((attr) => /^src\s*=\s*\{src\}$/.test(attr));
  if (guarded.length !== srcAttrs.length || srcAttrs.length === 0) {
    issues.push(
      `Favicon.tsx 出现不受 buildFaviconSrc 约束的 src 渲染点: ${srcAttrs.join(' | ') || '（无）'}` +
        '（只允许 src={src}）'
    );
  }
  if (/dangerouslySetInnerHTML|\binnerHTML\b/.test(text)) {
    issues.push('Favicon.tsx 出现 innerHTML 渲染路径');
  }
  // 对外口径：图标来源必须在 PRIVACY.md 说明（权限表 + 第 1 节）。
  if (existsSync(PRIVACY_DOC) && !/favicon/i.test(readFileSync(PRIVACY_DOC, 'utf8'))) {
    issues.push('PRIVACY.md 未说明站点图标来源（favicon 通道）');
  }
}

/** 权限表行的机读口径：首列是反引号包裹的权限名，其后为用途列。 */
const PERMISSION_ROW = /^\|\s*`([^`]+)`\s*\|(.*)$/;
/** 按需权限的机读标记：写在用途列里（与主机权限行同款）。 */
const OPTIONAL_MARK = /\boptional\b/i;
/** 主机权限的形态：` <all_urls>` 或 ` *://…` 或 ` http(s)://…`。 */
function isHostPermissionName(name) {
  return name === '<all_urls>' || name.includes('*://') || /^https?:\/\//.test(name);
}

/**
 * PRIVACY.md 第 2 节的权限表是本检查的**第二事实源**。
 *
 * 不能只比对脚本内硬编码的 ALLOWED_PERMISSIONS，否则 README / CONTRIBUTING /
 * PRIVACY.md 三处宣称的「新增权限须同步 PRIVACY.md，否则门禁失败」并不成立——
 * 改了 wxt.config.ts 而不动文档，门禁依然全绿。把文档解析为真实比对源，
 * 让「承诺」与「强制」对齐：源码清单与文档清单必须逐项一致。
 *
 * 解析结果按三类分桶（普通权限 / 可选权限 / 主机权限），三者各自与 manifest
 * 对应字段双向比对 —— 混在一个集合里会让「主机权限被整段删除」这类漂移
 * 被普通权限的集合掩盖。
 */
function readDocumentedPermissions() {
  if (!existsSync(PRIVACY_DOC)) return null;
  const text = readFileSync(PRIVACY_DOC, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^##\s*2\./.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const result = {
    permissions: new Set(),
    optionalPermissions: new Set(),
    hostPermissions: new Set()
  };
  for (const line of lines.slice(start, end)) {
    const row = line.match(PERMISSION_ROW);
    if (!row) continue;
    const name = row[1].trim();
    const rest = row[2];
    if (isHostPermissionName(name)) result.hostPermissions.add(name);
    else if (OPTIONAL_MARK.test(rest)) result.optionalPermissions.add(name);
    else result.permissions.add(name);
  }
  return result;
}

const issues = [];

/** 与文档集合的双向比对：两个方向的漂移都会失败。 */
function compareWithDocument(label, actual, documentedSet) {
  const undocumented = [...actual].filter((p) => !documentedSet.has(p));
  const staleDoc = [...documentedSet].filter((p) => !actual.has(p));
  if (undocumented.length > 0) {
    issues.push(`${label}已声明但未在 PRIVACY.md 记录: ${undocumented.sort().join(', ')}`);
  }
  if (staleDoc.length > 0) {
    issues.push(`PRIVACY.md 记录了 manifest 中已不存在的${label}: ${staleDoc.sort().join(', ')}`);
  }
}

if (!existsSync(MANIFEST)) {
  console.error('未找到构建产物，请先运行 pnpm build');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// ── manifest 结构冻结 ────────────────────────────────────────────────
// 这三类字段会引入既有检查完全覆盖不到的能力面：
//   content_scripts        向任意页面注入脚本（新的执行面）
//   externally_connectable 允许外部站点/扩展直接发消息（新的通信面）
//   web_accessible_resources 把内部资源暴露给页面（可被第三方引用）
// 当前一个都没有；出现即失败，需要时连同 PRIVACY.md 与本脚本一起改。
for (const key of ['content_scripts', 'externally_connectable', 'web_accessible_resources']) {
  if (manifest[key] !== undefined) {
    issues.push(`manifest 出现未审阅的 ${key}：会扩大注入或通信面，须先登记并评审`);
  }
}

// CSP 是零出站的运行时兜底：产物里没有 connect-src 'none' 时，唯一拦截点只剩本脚本。
const extensionCsp = manifest.content_security_policy?.extension_pages ?? '';
if (!/connect-src\s+'none'/.test(extensionCsp)) {
  issues.push("manifest 缺少 CSP connect-src 'none'：零出站红线失去浏览器层兜底");
}
// 只查 connect-src 不够，黑名单也不够：`img-src https://evil.example` 就是一次可用的
// 像素外发，而它既不含通配符也不是裸协议。改成**白名单**：每个指令只允许已知来源，
// 其余一律报「未登记」。
const unknownCspSources = findCspViolations(extensionCsp);
if (unknownCspSources.length > 0) {
  // dev 构建会放行 HMR 的 localhost 来源：报「未登记」会让人误以为改坏了代码。
  const devLike = unknownCspSources.some((source) => /localhost|127\.0\.0\.1/.test(source));
  issues.push(
    devLike
      ? `CSP 含 dev 来源（${unknownCspSources.join('; ')}）：当前是 dev 构建，请先 pnpm build 再校验`
      : `CSP 出现未登记来源: ${unknownCspSources.join('; ')}`
  );
}

const permissions = new Set(manifest.permissions ?? []);
const unexpected = [...permissions].filter((p) => !ALLOWED_PERMISSIONS.has(p));
if (unexpected.length > 0) issues.push(`未授权权限: ${unexpected.sort().join(', ')}`);

// 可选权限同样进冻结清单：它既不在 `permissions` 也不在 host 权限里，
// 不单独比对就完全游离在守卫之外。
const optionalPermissions = new Set(manifest.optional_permissions ?? []);
const unexpectedOptional = [...optionalPermissions].filter(
  (p) => !ALLOWED_OPTIONAL_PERMISSIONS.has(p)
);
if (unexpectedOptional.length > 0) {
  issues.push(`未授权可选权限: ${unexpectedOptional.sort().join(', ')}`);
}

// 权限清单 ↔ PRIVACY.md 双向比对（任一方向漏改都失败）。
const documented = readDocumentedPermissions();
if (documented === null) {
  issues.push('未找到 PRIVACY.md 第 2 节，无法校验权限清单与文档是否一致');
} else {
  compareWithDocument('权限', permissions, documented.permissions);
  compareWithDocument('可选权限', optionalPermissions, documented.optionalPermissions);
}

// 主机权限同样进冻结清单：`<all_urls>` 是本项目最敏感的一项声明，
// 只查 permissions 会让它完全游离在守卫之外。
const requiredHosts = new Set(manifest.host_permissions ?? []);
const optionalHosts = new Set(manifest.optional_host_permissions ?? []);
// 合并集合只用于「是否在冻结清单内」与文档双向比对；必需/按需必须分开判：
// 合并后把 <all_urls> 从 optional_host_permissions 挪到 host_permissions，两边内容一模一样，
// 门禁与文档比对全绿，而安装时已经变成「必须授予全部站点」。
if (requiredHosts.size > 0) {
  issues.push(
    `主机权限必须以按需方式申请，但 manifest 声明为必需: ${[...requiredHosts].sort().join(', ')}`
  );
}
const hostPermissions = new Set([...requiredHosts, ...optionalHosts]);
const unexpectedHosts = [...hostPermissions].filter(
  (p) => !ALLOWED_OPTIONAL_HOST_PERMISSIONS.has(p)
);
if (unexpectedHosts.length > 0) {
  issues.push(`未授权主机权限: ${unexpectedHosts.sort().join(', ')}`);
}
// 主机权限同样做双向比对：只与冻结清单单向比对时，整段删掉
// `optional_host_permissions` 门禁一绿到底（文档侧无人校验）。
if (documented !== null) {
  compareWithDocument('主机权限', hostPermissions, documented.hostPermissions);
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

function scanFiles(files, label, commentsExempt = true) {
  let hits = 0;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    // HTML 与 CSS 是被浏览器直接解析的受保护对象，不豁免注释行；源码才豁免。
    // 构建产物必须按「不豁免注释」处理：压缩后的 bundle 是单行，行首一个 `//`
    // 就能让整行（含真实 fetch 调用）被跳过。
    const literalTarget = file.endsWith('.html') || file.endsWith('.css');
    const exempt = literalTarget || !commentsExempt ? NETWORK_EXEMPT_HTML : NETWORK_EXEMPT_CODE;
    let fileHits = 0;
    lines.forEach((line, i) => {
      if (fileHits >= MAX_HITS_PER_FILE) return;
      if (exempt.test(line)) return;
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

/**
 * 扫描面下限：路径写错/目录改名时 `scanFiles` 零命中也会「通过」，
 * 而这是零出站承诺的唯一拦截点。没有下游判据能兜住空扫描，只能在这里自己红。
 */
function expectSurface(files, label, min) {
  if (files.length < min) {
    issues.push(`${label}扫描面异常：仅 ${files.length} 个文件（下限 ${min}），门禁可能已空转`);
  }
  return files;
}

/** 目录缺失本身就是一个失败项：用 existsSync 包住 = 扫描面静默归零仍报通过。 */
function surfaceWalk(dir, label, min) {
  if (!existsSync(dir)) {
    issues.push(`${label}目录不存在（${relative(ROOT, dir)}）：门禁可能已空转`);
    return [];
  }
  return expectSurface(walk(dir), label, min);
}

scanFiles(surfaceWalk(SRC, '源码', 150), '源码');

// 构建产物同样要扫：只扫 src/ 时，第三方依赖（pinyin-pro / tldts / fuzzysort 等）
// 打进 bundle 后的网络调用完全不可见，而「零出站网络请求」是面向**最终产物**
// 的承诺——用户安装的是 .output，不是 src。
scanFiles(
  surfaceWalk(OUT, '构建产物', 5).filter(
    (f) => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.css')
  ),
  '构建产物',
  // 产物不豁免注释行：压缩 bundle 是单行，行首 `//` 会让整行（含真实 fetch）被跳过。
  false
);

// 随包静态页（public/*.html，如卸载挽留页）同样要扫：它们被浏览器直接打开，
// 页面里一个外链字体或统计像素就是一次真实出站请求，故不能只扫 src/ 与产物 JS。
scanFiles(
  surfaceWalk(PUBLIC_DIR, '静态页', 1).filter((f) => f.endsWith('.html')),
  '静态页'
);

// 工作区包（packages/*）同样要扫：packages/i18n-kit 的运行时（src/index.ts /
// react.tsx）被 src/i18n 直接引用，是随包发布的运行时代码。只靠产物扫描是间接
// 覆盖 —— 改了包内源码而不重新构建，门禁完全看不见。
scanFiles(
  surfaceWalk(PACKAGES, '工作区包', 5).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')),
  '工作区包'
);

if (issues.length > 0) {
  console.error('隐私检查失败:');
  for (const issue of issues) console.error(`  ✗ ${issue}`);
  process.exit(1);
}

const sourceCount = walk(SRC).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).length;
const bundleCount = existsSync(OUT) ? walk(OUT).filter((f) => f.endsWith('.js')).length : 0;
const htmlCount =
  (existsSync(OUT) ? walk(OUT).filter((f) => f.endsWith('.html')).length : 0) +
  (existsSync(PUBLIC_DIR) ? walk(PUBLIC_DIR).filter((f) => f.endsWith('.html')).length : 0);
// CSS 与 HTML 同属「浏览器直接解析」的受保护对象，计数要出现在通过回执里：
// 它是「零出站网络请求」承诺覆盖的面，不显示就等于没人知道它被扫了。
const cssCount =
  (existsSync(SRC) ? walk(SRC).filter((f) => f.endsWith('.css')).length : 0) +
  (existsSync(OUT) ? walk(OUT).filter((f) => f.endsWith('.css')).length : 0);
const packageCount = existsSync(PACKAGES)
  ? walk(PACKAGES).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).length
  : 0;
console.log(
  `隐私检查通过: 权限 ${[...permissions].sort().join(', ')}，` +
    `主机权限 ${[...hostPermissions].sort().join(', ')}，` +
    `网络通道调用 0（源码 ${sourceCount} 个 + 工作区包 ${packageCount} 个 + ` +
    `产物 ${bundleCount} 个 JS / ${htmlCount} 个 HTML / ${cssCount} 个 CSS），` +
    `权限清单与 PRIVACY.md 一致，` +
    `存储键 ${sourceKeys.size} 个与 PRIVACY.md 第 3 节一致，图标渲染闸门在位`
);
