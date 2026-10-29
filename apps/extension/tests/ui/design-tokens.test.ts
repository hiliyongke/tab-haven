/**
 * UI 设计令牌行为规格：检查所有主题与色相组合的对比度、CSS 变量引用、令牌范围、
 * 字号与间距刻度，以及按钮指针样式和高对比度模式适配。
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
/** CSS 变量也可能由 `.ts` 注入（如主题应用器），扫描需覆盖两种扩展名。 */
const sourceFiles = [...tsxFiles, ...walk(SRC_DIR, '.ts')].sort();

/** 运行时注入的 CSS 变量从源码提取，并与 CSS 中声明的变量一并校验。 */
/** 字号豁免的适用文件（URL 副标题只此一处，见用例内的说明）。 */
function isTabRowFile(file: string): boolean {
  return relative(ROOT, file) === join('src', 'ui', 'tabs', 'TabRow.tsx');
}

function runtimeInjectedVars(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(/['"`](--[\w-]+)['"`]/g)) found.add(match[1]!);
  }
  return found;
}

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

/**
 * 去掉块注释但**保留行号**（注释内容替换为等长空白）。
 *
 * 只按「行首是否 * 或 //」过滤会把块注释的续行算成代码：注释里提到
 * `text-gray-400`（解释为什么不用它）就会把自己变成一条失败项。
 */
function withoutBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * 判断一行 `text-gray-400` 用法是否属于装饰性豁免。
 *
 * 豁免只有两类、且都能在这一行内自证：**纯图标**（`<Icon …/>`，WCAG 口径里是
 * 非文本）与 **aria-hidden 的装饰符号**（如分隔点「·」，不进入可访问树）。
 * 承载信息的文字一律走 gray-500。
 */
function isDecorativeGray400(line: string): boolean {
  return /<Icon\b/.test(line) || /aria-hidden/.test(line);
}

/** 弱对比度令牌 `--c-gray-400` 仅用于图标与装饰元素，不承载文字信息。 */
describe('弱对比度令牌不得承载信息', () => {
  it('TSX 不得用 text-gray-400 承载文字（装饰性元素除外）', () => {
    const failures: string[] = [];
    for (const file of tsxFiles) {
      const src = withoutBlockComments(readFileSync(file, 'utf8'));
      src.split('\n').forEach((line, i) => {
        // 行注释同样不算用法。
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (!/\btext-gray-400\b/.test(line)) return;
        if (isDecorativeGray400(line)) return;
        failures.push(
          `${relative(ROOT, file)}:${i + 1} text-gray-400 对比度不足（<4.5:1），请改用 text-gray-500`
        );
      });
    }
    expect(failures).toEqual([]);
  });

  it('判据本身必须命中（正则写错 / 扫描目录为空时上一条会恒绿）', () => {
    // 与「CSS 变量定义完整性」同因：命中集合为空时，上一条用例退化成永远通过。
    expect(tsxFiles.length).toBeGreaterThan(0);
    expect(isDecorativeGray400('<span className="text-gray-400">共 3 项</span>')).toBe(false);
    expect(
      isDecorativeGray400('<Icon d={Icons.infoAlert} className="h-3.5 w-3.5 text-gray-400" />')
    ).toBe(true);
    expect(isDecorativeGray400('<span className="text-gray-400" aria-hidden="true">·</span>')).toBe(
      true
    );
  });
});

describe('CSS 变量定义完整性', () => {
  it('var() 引用的变量必须已声明（否则整条声明静默失效）', () => {
    const declared = new Set([...cssNoComments.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
    // 由 JS 在运行时通过内联样式注入的变量，属预期（集合取自源码，见 runtimeInjectedVars）
    const runtimeInjected = runtimeInjectedVars();
    const used = new Set([...cssNoComments.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!));
    const missing = [...used].filter((v) => !declared.has(v) && !runtimeInjected.has(v)).sort();
    expect(missing).toEqual([]);
  });

  it('抽取本身必须命中（空集合会让上一条用例恒绿）', () => {
    // 与上一条同因：若正则写错或源码目录变了，runtimeInjectedVars() 返回空集，
    // 上一条用例会退化成「所有变量都必须声明」，看起来更严而非报错——
    // 而真正想放行的那几个变量会悄悄变成误报，最后被人改成硬编码白名单。
    expect(runtimeInjectedVars().size).toBeGreaterThan(0);
  });
});

describe('设计令牌边界', () => {
  const defined = new Set([...css.matchAll(/--color-([a-z]+-\d+)\s*:/g)].map((m) => m[1]!));
  // outline / shadow / rounded / accent 不在扫描范围内时，圆角与阴影类
  // 因此完全游离在守卫之外（散写 rounded-lg / shadow-lg 无人拦截）。
  const PREFIXES =
    'bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder|outline|shadow|rounded|accent';
  const tokenRe = new RegExp(
    `\\b(?:${PREFIXES})-((?:accent|gray|warn|red|surface|on-accent|control)-\\d+)`
  );

  // Tailwind 默认调色板（未被 @theme 重映射，使用即视为泄漏）。
  // black / white 必须在列：白名单漏了它们，遮罩就会各自写 bg-black/30。
  const UNCONTROLLED = [
    'black',
    'white',
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
        // 限定「指定文件 + 类名 token 精确匹配」：`includes('tab-url')` 会把任何
        // 提到该串的行（注释、tab-url-host 这类邻近类名）一并放行，守卫的边界
        // 随注释与邻近命名漂移，最终变成一块无人解释的免检区。
        if (isTabRowFile(file) && /\btab-url\b/.test(line)) return;
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

describe('间距 / 圆角 / 阴影刻度', () => {
  /** 间距、圆角与阴影使用设计刻度；宽高类可按容器尺寸需求单独设置。 */
  it('间距与圆角、阴影不得散写任意值', () => {
    const failures: string[] = [];
    // 仅覆盖内/外边距与间隙：这些才是 4px 网格的适用范围。
    const spacingArbitrary = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-\[[^\]]*px\]/;
    const shapeArbitrary = /\b(?:rounded|shadow)-\[/;
    for (const file of tsxFiles) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        if (spacingArbitrary.test(line)) {
          failures.push(`${relative(ROOT, file)}:${i + 1} 任意值间距，请改用 4px 刻度工具类`);
        }
        if (shapeArbitrary.test(line)) {
          failures.push(
            `${relative(ROOT, file)}:${i + 1} 任意值圆角/阴影，请改用 rounded-* / shadow-elev-* 令牌`
          );
        }
      });
    }
    expect(failures).toEqual([]);
  });
});

describe('交互基线', () => {
  /** Button 与 IconButton 的基类为按钮提供指针光标。 */
  it('Button 与 IconButton 基类必须声明 cursor-pointer', () => {
    const button = readFileSync(join(SRC_DIR, 'ui', 'common', 'Button.tsx'), 'utf8');
    const iconButton = readFileSync(join(SRC_DIR, 'ui', 'common', 'IconButton.tsx'), 'utf8');
    expect(button).toMatch(/cursor-pointer/);
    expect(iconButton).toMatch(/cursor-pointer/);
  });

  /**
   * UI-02 守卫：forced-colors 适配块整体删除或改名后，CI 须能拦下。
   * （Windows 高对比度下 color-mix 状态色会退化为不可辨，详见 main.css 内注释。）
   */
  it('main.css 必须包含 forced-colors 适配块', () => {
    expect(css).toMatch(/@media \(forced-colors: active\)/);
  });

  /**
   * UI-03 守卫：全局焦点环不得重新写死 border-radius（outline 沿元素自身圆角绘制）。
   * 写死 6px 会让特异性 (0,1,0) 与单类同级，圆角归属随书写顺序漂移。
   */
  it('全局焦点环不得声明固定 border-radius', () => {
    const block = cssNoComments.match(
      /:where\(button, a, input, select, textarea, summary, \[tabindex\], \[role='button'\]\):focus-visible\s*\{[^}]*\}/
    );
    expect(block, '未找到全局焦点环规则块').not.toBeNull();
    expect(block![0]).not.toMatch(/border-radius/);
  });
});
