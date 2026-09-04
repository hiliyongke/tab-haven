#!/usr/bin/env node
/**
 * i18n 死键守卫（P1-3）：locale 中每个键必须被 src 源码引用，否则构建失败。
 *
 * 运行：npm run check:i18n
 *
 * 三条规则：
 *   1. zh-CN 与 en 的键集合必须完全一致（漏译 / 多译即失败）
 *   2. 每个键必须在 src 下全部 .ts/.tsx 源码中出现精确串匹配
 *      （键作为 t('...') / labelKey 等字面量出现，静态可查）
 *   3. 模板串动态拼接的键（静态扫描原理上无法匹配）通过 DYNAMIC_KEY_PATTERNS 豁免；
 *      新增动态拼接点时必须同步登记此处，防止白名单与代码漂移。
 *
 * 与 privacy-check 同为独立 CLI（非 Vitest 用例）：无需 jsdom 环境，毫秒级完成。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');
const LOCALES = {
  'zh-CN': join(ROOT, 'src/i18n/locales/zh-CN/translation.json'),
  en: join(ROOT, 'src/i18n/locales/en/translation.json')
};

/** 动态拼接键白名单：OnboardingTour.tsx 用 `onboarding.step${step}Title/Body` 模板串构造。 */
const DYNAMIC_KEY_PATTERNS = [/^onboarding\.step\d+(Title|Body)$/];

const SCANNABLE = new Set(['.ts', '.tsx']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCANNABLE.has(full.slice(full.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

/** 递归展开嵌套 JSON 为点号键路径（数组下标不参与，项目未用数组文案）。 */
function flatten(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') keys.push(...flatten(v, path));
    else keys.push(path);
  }
  return keys;
}

const localeKeys = {};
for (const [locale, file] of Object.entries(LOCALES)) {
  localeKeys[locale] = flatten(JSON.parse(readFileSync(file, 'utf8')));
}

const issues = [];

// 规则 1：中英键集合一致
const zhSet = new Set(localeKeys['zh-CN']);
const enSet = new Set(localeKeys.en);
const missingInEn = localeKeys['zh-CN'].filter((k) => !enSet.has(k));
const extraInEn = localeKeys.en.filter((k) => !zhSet.has(k));
if (missingInEn.length > 0) issues.push(`en 缺少键: ${missingInEn.sort().join(', ')}`);
if (extraInEn.length > 0) issues.push(`en 多余键: ${extraInEn.sort().join(', ')}`);

// 规则 2/3：源码精确串匹配 + 动态键白名单豁免
const sourceBlob = walk(SRC)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/**
 * 键被引用的判定：前面紧邻引号（'/'/`），后面不是单词字符或点号。
 * 纯 includes 会把 settings.on 误判为被 settings.onboarded 引用（假阴性），
 * 后缀断言同时排除「更长键的前缀」与「更长标识符的子串」两类误报。
 */
const isReferenced = (key) =>
  new RegExp(`['\`]${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?![\\w.])`).test(sourceBlob);

const deadKeys = localeKeys['zh-CN'].filter(
  (key) => !isReferenced(key) && !DYNAMIC_KEY_PATTERNS.some((pattern) => pattern.test(key))
);
if (deadKeys.length > 0) {
  issues.push(`死键（零源码引用）: ${deadKeys.sort().join(', ')}`);
}

if (issues.length > 0) {
  console.error('i18n 死键检查失败:');
  for (const issue of issues) console.error(`  ✗ ${issue}`);
  console.error(`共 ${localeKeys['zh-CN'].length} 键，死键 ${deadKeys.length} 个`);
  process.exit(1);
}

console.log(
  `i18n 死键检查通过: zh-CN/en 各 ${localeKeys['zh-CN'].length} 键且集合一致，` +
    `动态键白名单 ${DYNAMIC_KEY_PATTERNS.length} 条，死键 0`
);
