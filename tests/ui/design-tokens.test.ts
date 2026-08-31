/**
 * UI 设计令牌守卫：对比度 / 未定义变量 / 越界令牌 / 字号令牌。
 *
 * 把 2026-08-27 那次 UI 审计中「本可以被机器发现」的四类问题固化为断言，
 * 防止它们悄悄回到代码库：
 *
 *   1. 对比度：对「主题 × 色相 × 前景/背景」全矩阵断言 WCAG 2.1 阈值。
 *      历史坑：--ring 用 rgba(品牌, .32) 合成后仅 1.55:1，键盘焦点在浅色下几乎不可见；
 *              --c-gray-500 弱文本 4.12:1；表单边框 border-gray-200 仅 1.33:1。
 *   2. 未定义变量：CSS 里 var(--x) 引用的 --x 必须被声明。
 *      历史坑：--c-red-200 被引用但从未定义，导致整条 border-color 声明静默失效（IAC）。
 *   3. 越界令牌：TSX 里用到的 `accent-N / gray-N / warn-N / red-N` 必须在 @theme 中定义；
 *      同时禁止直接使用 Tailwind 默认调色板（不随主题换肤）。
 *      历史坑：hover:text-accent-800（@theme 只到 700，类名不生成任何 CSS）、
 *              text-amber-600（浅色下仅 3.19:1，深色下 bg-amber-100 变成刺眼亮黄）。
 *   4. 字号令牌：禁止散写 text-[10px] 这类任意值，统一走 text-2xs。
 *
 * 纯静态分析，不依赖构建产物，因此放在测试套件内随 `pnpm test` 执行。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CSS_PATH = join(ROOT, 'src', 'styles', 'main.css');
const SRC_DIR = join(ROOT, 'src');

const THEMES = ['light', 'dark'] as const;
const HUES = ['forest', 'ocean', 'violet', 'sunset', 'mono', 'plain'] as const;

type Palette = Record<string, string>;

// ---------------------------------------------------------------- 对比度数学

function channelLin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b);
}

function hexToRgb(value: string): [number, number, number] | null {
  const v = value.trim();
  if (!v.startsWith('#')) return null;
  let h = v.slice(1);
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16)
  ];
}

function contrast(fg: string, bg: string): number | null {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------- CSS 解析

/** 解析所有 `:root[...]{...}` 块，返回 {选择器: {变量: 值}}。 */
function parseBlocks(css: string): Record<string, Palette> {
  const blocks: Record<string, Palette> = {};
  const openRe = /(:root(?:\[[^\]]+\])*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(css)) !== null) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let k = start;
    for (;;) {
      if (css[k] === '{') depth += 1;
      else if (css[k] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      k += 1;
    }
    let body = css.slice(start + 1, k);
    // 去掉块内注释，避免 `/* 主强调 */` 之类的文字被当作值的一部分
    body = body.replace(/\/\*[\s\S]*?\*\//g, '');
    const decl: Palette = {};
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decl[d[1]!] = d[2]!;
    blocks[m[1]!] = { ...blocks[m[1]!], ...decl };
  }
  return blocks;
}

/** 按层级合并出某个（主题, 色相）组合下的完整令牌表。 */
function buildPalette(blocks: Record<string, Palette>, theme: string, hue: string): Palette {
  const p: Palette = { ...blocks[':root'] };
  if (hue !== 'forest') Object.assign(p, blocks[`:root[data-hue='${hue}']`] ?? {});
  if (theme === 'dark') {
    Object.assign(p, blocks[":root[data-theme='dark']"] ?? {});
    if (hue !== 'forest') {
      Object.assign(p, blocks[`:root[data-theme='dark'][data-hue='${hue}']`] ?? {});
    }
  }
  return p;
}

/**
 * 把 var(--x) 递归解析成十六进制字面量。
 * 无法判定（Canvas / color-mix(...) 等非字面量）返回 null，交由调用方跳过。
 */
function resolveVar(name: string, palette: Palette, depth = 0): string | null {
  if (depth > 8) return null;
  const raw = palette[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*?)\s*)?\)$/.exec(value);
  if (m) {
    const inner = resolveVar(m[1]!, palette, depth + 1);
    if (inner !== null) return inner;
    const fallback = (m[2] ?? '').trim();
    return hexToRgb(fallback) ? fallback : null;
  }
  return hexToRgb(value) ? value : null;
}

// ---------------------------------------------------------------- 断言矩阵

interface PairSpec {
  label: string;
  fg: string;
  bg: string;
  need: number;
}

/** 阈值依据 WCAG 2.1：正文 1.4.3 需 4.5；非文本（控件边界/图标）1.4.11 需 3.0。 */
const TEXT_PAIRS: PairSpec[] = [
  { label: '正文 gray-800 / canvas', fg: '--c-gray-800', bg: '--canvas', need: 4.5 },
  { label: '次级 gray-700 / surface', fg: '--c-gray-700', bg: '--surface', need: 4.5 },
  { label: '次级 gray-600 / surface', fg: '--c-gray-600', bg: '--surface', need: 4.5 },
  { label: '弱文本 gray-500 / canvas', fg: '--c-gray-500', bg: '--canvas', need: 4.5 },
  { label: '计数胶囊 gray-600 / gray-100', fg: '--c-gray-600', bg: '--c-gray-100', need: 4.5 },
  { label: '主按钮 on-accent / brand-600', fg: '--c-on-accent', bg: '--c-brand-600', need: 4.5 },
  { label: '危险按钮 on-accent / red-600', fg: '--c-on-accent', bg: '--c-red-600', need: 4.5 },
  { label: 'soft 按钮 brand-600 / brand-50', fg: '--c-brand-600', bg: '--c-brand-50', need: 4.5 },
  { label: '媒体胶囊 brand-700 / brand-50', fg: '--c-brand-700', bg: '--c-brand-50', need: 4.5 },
  { label: '搜索命中 brand-700 / surface', fg: '--c-brand-700', bg: '--surface', need: 4.5 },
  {
    label: '计数徽章 on-accent / count-badge-bg',
    fg: '--c-on-accent',
    bg: '--count-badge-bg',
    need: 4.5
  },
  { label: '警示 warn-700 / warn-50', fg: '--c-warn-700', bg: '--c-warn-50', need: 4.5 },
  { label: '警示 warn-700 / warn-100', fg: '--c-warn-700', bg: '--c-warn-100', need: 4.5 },
  { label: '危险 red-600 / canvas', fg: '--c-red-600', bg: '--canvas', need: 4.5 }
];

const NON_TEXT_PAIRS: PairSpec[] = [
  { label: '焦点环 ring / canvas', fg: '--ring', bg: '--canvas', need: 3 },
  { label: '焦点环 ring / surface', fg: '--ring', bg: '--surface', need: 3 },
  { label: '控件边框 border-control / surface', fg: '--border-control', bg: '--surface', need: 3 },
  { label: '控件边框 border-control / canvas', fg: '--border-control', bg: '--canvas', need: 3 },
  { label: '图标 gray-500 / canvas', fg: '--c-gray-500', bg: '--canvas', need: 3 },
  { label: '开关轨道 border-control / canvas', fg: '--border-control', bg: '--canvas', need: 3 }
];

const ALL_PAIRS = [...TEXT_PAIRS, ...NON_TEXT_PAIRS];

// ---------------------------------------------------------------- 源码遍历

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

// ---------------------------------------------------------------- 用例

const css = readFileSync(CSS_PATH, 'utf8');
const blocks = parseBlocks(css);
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const tsxFiles = walk(SRC_DIR, '.tsx');

describe('对比度矩阵（2 主题 × 6 色相，WCAG 2.1 AA）', () => {
  for (const spec of ALL_PAIRS) {
    it(spec.label, () => {
      const failures: string[] = [];
      let checked = 0;
      for (const theme of THEMES) {
        for (const hue of HUES) {
          const palette = buildPalette(blocks, theme, hue);
          const fg = resolveVar(spec.fg, palette);
          const bg = resolveVar(spec.bg, palette);
          if (fg === null || bg === null) continue; // 含 color-mix / Canvas，跳过
          checked += 1;
          const ratio = contrast(fg, bg);
          if (ratio === null || ratio < spec.need) {
            failures.push(
              `[${theme}/${hue}] ${ratio === null ? '无法计算' : `${ratio.toFixed(2)}:1`} < ${spec.need} (${fg} on ${bg})`
            );
          }
        }
      }
      expect(checked, '没有任何可判定的组合被校验，检查令牌名是否写错').toBeGreaterThan(0);
      expect(failures).toEqual([]);
    });
  }
});

describe('CSS 变量定义完整性', () => {
  it('var() 引用的变量必须已声明（否则整条声明静默失效）', () => {
    const declared = new Set([...cssNoComments.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
    // 由 JS 在运行时通过内联样式注入的变量，属预期
    const runtimeInjected = new Set(['--accent', '--tile-accent', '--group-accent']);
    const used = new Set([...cssNoComments.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!));
    const missing = [...used].filter((v) => !declared.has(v) && !runtimeInjected.has(v)).sort();
    expect(missing).toEqual([]);
  });
});

describe('设计令牌边界', () => {
  const defined = new Set([...css.matchAll(/--color-([a-z]+-\d+)\s*:/g)].map((m) => m[1]!));
  const PREFIXES = 'bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder';
  const tokenRe = new RegExp(
    `\\b(?:${PREFIXES})-((?:accent|gray|warn|red|surface|on-accent|control)-\\d+)`
  );

  // Tailwind 默认调色板（未被 @theme 重映射，使用即视为泄漏）
  const UNCONTROLLED = [
    'slate',
    'zinc',
    'neutral',
    'stone',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'purple',
    'fuchsia',
    'pink',
    'rose',
    'orange'
  ];
  const leakRe = new RegExp(`\\b(?:${PREFIXES})-(?:${UNCONTROLLED.join('|')})(?:-\\d{2,3})?\\b`);

  it('TSX 不得使用 @theme 未定义的令牌档位', () => {
    const failures: string[] = [];
    for (const file of tsxFiles) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(new RegExp(tokenRe, 'g'))) {
        if (!defined.has(m[1]!)) {
          failures.push(`${relative(ROOT, file)}:${lineOf(src, m.index!)} 越界令牌 \`${m[1]}\``);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('TSX 不得直接使用未受控的 Tailwind 默认调色板', () => {
    const failures: string[] = [];
    for (const file of tsxFiles) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(new RegExp(leakRe, 'g'))) {
        failures.push(
          `${relative(ROOT, file)}:${lineOf(src, m.index!)} 未受控调色板 \`${m[0]}\`（请改用 warn/red/accent 令牌）`
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('字号令牌', () => {
  it('不得散写 text-[Npx] 任意值（10px 由 text-2xs 承载）', () => {
    const failures: string[] = [];
    for (const file of tsxFiles) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        if (/\btext-\[(?:[0-9]|10)px\]/.test(line)) {
          failures.push(`${relative(ROOT, file)}:${i + 1} 任意值字号，请改用 text-2xs 令牌`);
        }
      });
    }
    expect(failures).toEqual([]);
  });

  it('text-2xs 不得与多行 leading-* 同现（正文说明须 ≥11px 即 text-3xs）', () => {
    const failures: string[] = [];
    for (const file of tsxFiles) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        // 豁免：TabRow 的 URL 副标题（tab-url）——单行截断的扫视型元数据，
        // 经产品决策保持 10px；其行高与虚拟列表 itemSize 公式隐式耦合（B6）。
        if (line.includes('tab-url')) return;
        if (/text-2xs/.test(line) && /leading-(relaxed|snug|tight|loose|normal)/.test(line)) {
          failures.push(
            `${relative(ROOT, file)}:${i + 1} text-2xs 搭配多行行高 leading-*，正文说明应改用 text-3xs`
          );
        }
      });
    }
    expect(failures).toEqual([]);
  });
});
