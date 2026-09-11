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
 * **签名身份**：.output/tabs.pem（首次生成后自动固化）。
 * 同一扩展的后续版本必须复用同一 pem，否则 Chrome 视作不同扩展、无法覆盖升级。
 * 该文件已被 .gitignore 覆盖（*.pem 与 .output/ 双重忽略）——请另存备份，
 * 注意 .output/ 是构建产物目录，清理时会连同删除。
 *
 * 用途提醒：Chrome Web Store 上架用 zip（pnpm zip），crx 只用于企业策略分发
 * 或开发者模式下的自动化测试；普通用户无法直接安装商店外来源的 crx。
 *
 * 浏览器探测顺序：$CHROME_PATH → 平台常见安装位置（Chrome / Edge / Chromium / Brave）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, '.output');
const EXT_DIR = path.join(OUTPUT_DIR, 'chrome-mv3');
/** 签名私钥固定名：与构建产物目录名解耦，便于长期复用与备份。 */
const KEY_PATH = path.join(OUTPUT_DIR, 'tabs.pem');
/** Chrome 以「扩展目录名」命名产物，这两条是它固定写出的路径。 */
const RAW_CRX = path.join(OUTPUT_DIR, 'chrome-mv3.crx');
const RAW_KEY = path.join(OUTPUT_DIR, 'chrome-mv3.pem');

const log = (message) => console.log(message);

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

// ---- 3. 复用既有签名身份 ----
// 手动执行过 --pack-extension 的机器上会留下 chrome-mv3.pem；
// 若存在则先固化到 tabs.pem，避免本次重新生成新身份导致升级链断裂。
if (!existsSync(KEY_PATH) && existsSync(RAW_KEY)) {
  renameSync(RAW_KEY, KEY_PATH);
  log('• 复用已有签名密钥 → .output/tabs.pem');
}

// ---- 4. 打包 ----
const hasKey = existsSync(KEY_PATH);
const args = [`--pack-extension=${EXT_DIR}`, '--no-message-box'];
if (hasKey) args.push(`--pack-extension-key=${KEY_PATH}`);
log(`• 浏览器：${browser}`);
log(
  `• 签名密钥：${hasKey ? '复用 .output/tabs.pem' : '首次生成（完成后固化为 .output/tabs.pem）'}`
);

spawnSync(browser, args, { stdio: 'inherit' });

if (!waitForFile(RAW_CRX, 30_000)) {
  console.error('✗ 打包失败：30s 内未生成 .crx（可尝试手动运行上面的浏览器命令排查）');
  process.exit(1);
}

// 首次打包时浏览器同时写出 pem：固化为固定名。
if (!existsSync(KEY_PATH) && existsSync(RAW_KEY)) {
  renameSync(RAW_KEY, KEY_PATH);
  log('• 已生成签名密钥 → .output/tabs.pem（请备份；.output/ 清理时会一并删除）');
}

// ---- 5. 按版本命名产物 ----
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const finalPath = path.join(OUTPUT_DIR, `tabs-${version}.crx`);
if (existsSync(finalPath)) unlinkSync(finalPath);
renameSync(RAW_CRX, finalPath);
log(
  `✔ CRX 已生成：${path.relative(ROOT, finalPath)}（${(statSync(finalPath).size / 1024).toFixed(1)} KB）`
);
