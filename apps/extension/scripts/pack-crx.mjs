#!/usr/bin/env node
/**
 * 打包 CRX3（Chrome 扩展的离线分发格式）。
 *
 * 运行：pnpm crx（内部先 wxt build）
 * 产物：.output/tabs-<version>.crx
 *
 * 为什么调浏览器自带的 --pack-extension 而不用第三方库：这是官方实现，
 * 零依赖，签名格式永远与浏览器一致；Node 侧库（crx3 等）需要额外依赖，
 * 且要自行跟进 CRX3 的签名细节。
 *
 * **签名身份**：`~/.config/tabs/tabs.pem`（首次生成后固化；可用 `TABS_SIGNING_KEY` 覆盖）。
 * 同一扩展的后续版本必须复用同一 pem，否则 Chrome 视作不同扩展、无法覆盖升级。
 * 私钥与 `.output/` 解耦（清理产物不会丢密钥），脚本会强制收紧为 600，并把推导出的
 * 扩展 ID 记到 `tabs.pem.id`——身份与上次不一致即拒绝打包（`TABS_ROTATE_KEY=1` 才轮换）。
 *
 * 用途提醒：Chrome Web Store 上架用 zip（pnpm zip），crx 只用于企业策略分发
 * 或开发者模式下的自动化测试；普通用户无法直接安装商店外来源的 crx。
 *
 * 浏览器探测顺序：$CHROME_PATH → 平台常见安装位置（Chrome / Edge / Chromium / Brave）。
 */

import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  assertBrowserSpawnSucceeded,
  assertGeneratedSigningKey,
  assertIdentityRecord,
  removeStaleCrx,
  writeIdentityRecord
} from './pack-crx-process.ts';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, '.output');
const EXT_DIR = path.join(OUTPUT_DIR, 'chrome-mv3');
/**
 * 签名私钥**不放在 .output**：那是构建产物目录，`rm -rf .output` / `wxt clean`
 * 会把它一起删掉，下次打包就会静默生成新身份——Chrome 视作另一个扩展，
 * 已安装用户无法覆盖升级，且不可逆。
 *
 * 默认放用户配置目录（可用 TABS_SIGNING_KEY 覆盖路径），与产物解耦、便于备份。
 */
const DEFAULT_KEY_DIR =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? homedir(), 'tabs')
    : path.join(homedir(), '.config', 'tabs');
const KEY_PATH = process.env.TABS_SIGNING_KEY ?? path.join(DEFAULT_KEY_DIR, 'tabs.pem');
/** 记录「首次生成时的扩展 ID」：身份变了就拒绝打包，避免静默换代。 */
const KEY_ID_PATH = `${KEY_PATH}.id`;
/** Chrome 以「扩展目录名」命名产物，这两条是它固定写出的路径。 */
const RAW_CRX = path.join(OUTPUT_DIR, 'chrome-mv3.crx');
const RAW_KEY = path.join(OUTPUT_DIR, 'chrome-mv3.pem');

const log = (message) => console.log(message);

/** 私钥只该被当前用户读取；权限过宽时收紧并留痕。 */
function ensureKeyPermissions(file) {
  if (process.platform === 'win32') return; // Windows 无 POSIX 权限位
  const mode = statSync(file).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    chmodSync(file, 0o600);
    log(`• 已收紧签名密钥权限 ${mode.toString(8)} → 600：${file}`);
  }
}

/** 由私钥推导 Chrome 扩展 ID（公钥 DER 的 SHA-256 前 16 字节，0-f 映射到 a-p）。 */
function extensionIdFromKey(file) {
  const der = createPublicKey(readFileSync(file)).export({ type: 'spki', format: 'der' });
  return [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
    .map((char) => String.fromCharCode(97 + Number.parseInt(char, 16)))
    .join('');
}

/**
 * 校验并记录签名身份。
 * 身份与上次不同即失败：这不是「换个 key 重打一次」的小事，而是升级链断裂。
 */
function reportIdentity(record = true) {
  if (!existsSync(KEY_PATH)) return;
  ensureKeyPermissions(KEY_PATH);
  const id = extensionIdFromKey(KEY_PATH);
  const recorded = existsSync(KEY_ID_PATH) ? readFileSync(KEY_ID_PATH, 'utf8').trim() : undefined;
  try {
    assertIdentityRecord(recorded, id, process.env.TABS_ROTATE_KEY === '1');
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    if (recorded !== undefined && recorded !== '' && recorded !== id) {
      console.error('  换身份会让已安装用户无法覆盖升级。确需轮换请设 TABS_ROTATE_KEY=1。');
    }
    process.exit(1);
  }
  if (record) writeIdentityRecord(KEY_ID_PATH, id);
  log(`• 扩展 ID：${id}（密钥 ${path.relative(ROOT, KEY_PATH)}）`);
}

/** 同步轮询等待文件出现（部分平台会把打包请求转交运行中的实例后立即返回）。 */
function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (existsSync(file)) return true;
    // 一次性 CLI 脚本，Atomics.wait 同步阻塞比忙等省 CPU。
    Atomics.wait(sleeper, 0, 0, 200);
  }
  return false;
}

// ---- 1. 构建产物 ----
if (!existsSync(EXT_DIR)) {
  console.error('✗ 未找到构建产物 .output/chrome-mv3 —— 请先运行 pnpm build');
  process.exit(1);
}

// ---- 2. 浏览器可执行文件 ----
const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
  ],
  win32: [
    path.join(
      process.env.PROGRAMFILES ?? 'C:\\Program Files',
      'Google/Chrome/Application/chrome.exe'
    ),
    path.join(
      process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
      'Google/Chrome/Application/chrome.exe'
    ),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    path.join(
      process.env.PROGRAMFILES ?? 'C:\\Program Files',
      'Microsoft/Edge/Application/msedge.exe'
    )
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge'
  ]
};
const candidates = CANDIDATES[process.platform] ?? [];
const browser = process.env.CHROME_PATH ?? candidates.find((candidate) => existsSync(candidate));
if (!browser) {
  console.error('✗ 未找到 Chrome / Edge / Chromium 可执行文件。');
  console.error('  可用 CHROME_PATH=/path/to/chrome pnpm crx 手动指定。');
  process.exit(1);
}

// ---- 3. 校验签名身份（打包成功前只校验，不推进轮换记录） ----
mkdirSync(path.dirname(KEY_PATH), { recursive: true });
reportIdentity(false);

// ---- 4. 打包 ----
const hasKey = existsSync(KEY_PATH);
const args = [`--pack-extension=${EXT_DIR}`, '--no-message-box'];
if (hasKey) args.push(`--pack-extension-key=${KEY_PATH}`);
log(`• 浏览器：${browser}`);
log(`• 签名密钥：${hasKey ? `复用 ${KEY_PATH}` : `首次生成（完成后固化为 ${KEY_PATH}）`}`);

removeStaleCrx(RAW_CRX);
// 首次打包不得让上一轮遗留的 PEM 冒充本轮新私钥。
if (!hasKey) removeStaleCrx(RAW_KEY);
try {
  assertBrowserSpawnSucceeded(spawnSync(browser, args, { stdio: 'inherit' }));
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!waitForFile(RAW_CRX, 30_000)) {
  console.error('✗ 打包失败：30s 内未生成 .crx（可尝试手动运行上面的浏览器命令排查）');
  process.exit(1);
}

// 首次打包时浏览器必须同时写出 pem：固化为固定名并记录身份。
try {
  assertGeneratedSigningKey(!hasKey, existsSync(RAW_KEY));
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (!hasKey) {
  renameSync(RAW_KEY, KEY_PATH);
  log(`• 已生成签名密钥 → ${KEY_PATH}（请备份到密码管理器/密钥库）`);
}
reportIdentity();

// ---- 5. 按版本命名产物 ----
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const finalPath = path.join(OUTPUT_DIR, `tabs-${version}.crx`);
if (existsSync(finalPath)) unlinkSync(finalPath);
renameSync(RAW_CRX, finalPath);
log(
  `✔ CRX 已生成：${path.relative(ROOT, finalPath)}（${(statSync(finalPath).size / 1024).toFixed(1)} KB）`
);
