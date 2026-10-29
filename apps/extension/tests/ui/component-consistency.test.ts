import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 组件一致性守卫（`.codebuddy/skills/ui-component/SKILL.md` 的结构性落地）。
 *
 * `design-tokens.test.ts` 管**令牌**（颜色 / 字号 / 间距 / 对比度），本文件管
 * **结构**：同一个视觉形态只允许有一套 class 串，且收口用的语义类必须真实存在。
 *
 * 为什么需要它：审计发现「收口之后重复又在新位置复发」——`Button`/`IconButton`
 * 收口了，但 chip、行内图标按钮、分组小标题、输入下划线这些形态当时没有组件化，
 * 于是各业务文件各写一套 class 串。令牌守卫一条都拦不住这类重复。
 *
 * 每条断言都带「判据自测」：正则/取值写成常量后必须仍能命中一次已知样本，
 * 否则改坏了会静默恒绿（这是守卫最常见的失效方式）。
 */

const SRC_DIR = join(process.cwd(), 'src');
const CSS_PATH = join(SRC_DIR, 'styles', 'main.css');

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, ext);
    return full.endsWith(ext) ? [full] : [];
  });
}

const tsxFiles = walk(SRC_DIR, '.tsx');
const cssText = readFileSync(CSS_PATH, 'utf8');

/**
 * 注释不算代码：改类名时常在注释里留着旧串（本仓库就有一处），
 * 不剥离会把「解释为什么改」的注释本身判成违规。
 */
function stripComments(line: string): string {
  if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return '';
  return line.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
}

/** 在源码里按行搜，返回 `相对路径:行号` 列表（便于失败时直接定位）。 */
function findInSources(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of tsxFiles) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, index) => {
      if (pattern.test(stripComments(line)))
        hits.push(`${file.replace(SRC_DIR, 'src')}:${index + 1}`);
    });
  }
  return hits;
}

/**
 * 注释按字符替换成空白（保留换行）：既不让注释里的示例代码被判成违规，
 * 又保持与原文一致的偏移量，行号仍可直接定位。
 */
function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * 跨行搜索：JSX 属性换行是常态，逐行匹配对「多行写的 `<button className>`」完全失效
 * （历史缺陷：SectionHead 两处手写 .row-action 因此长期漏检，守卫恒绿）。
 */
function findAcrossLines(pattern: RegExp): string[] {
  const hits: string[] = [];
  // matchAll 要求全局标志；调用方传判据时不必关心这一点。
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  );
  for (const file of tsxFiles) {
    const text = stripBlockComments(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(global)) {
      const line = text.slice(0, match.index).split('\n').length;
      hits.push(`${file.replace(SRC_DIR, 'src')}:${line}`);
    }
  }
  return hits;
}

/** 显式豁免：必须是「形态不同、只是长得像」，且写清理由。新增豁免即放宽守卫，需评审。 */
const ALLOWED: Record<string, string[]> = {
  徽章: [
    // 1×1 小圆点（强调色），是列表项标记，不是徽章
    'src/entrypoints/about/AboutPage.tsx'
  ],
  下划线: [
    // 弹窗标题栏底部的装饰性分隔线（div 容器），不是输入框下划线
    'src/ui/dialog/Dialog.tsx'
  ]
};

describe('组件一致性：同一形态只有一套写法', () => {
  it('Given 输入下划线已收口为 .input-row / .input-line When 再搜手写下划线串 Then 为零', () => {
    // 判据自测：这三个样本必须被正则命中，否则说明正则已失效。
    expect(
      /border-b border-(gray-200|control|subtle)/.test('className="border-b border-gray-200"')
    ).toBe(true);

    const hits = findInSources(/border-b\s+border-(?:gray-200|control|subtle)/).filter(
      (hit) => !ALLOWED['下划线']!.some((file) => hit.startsWith(file))
    );
    expect(hits, `手写下划线串应改为 .input-row / .input-line：\n${hits.join('\n')}`).toEqual([]);
  });

  it('Given 分组小标题已收口为 .group-label When 再搜字面 class 串 Then 为零', () => {
    const sample = 'className="text-3xs font-medium tracking-wide text-gray-500"';
    expect(/text-3xs\s+font-medium\s+tracking-wide\s+text-gray-500/.test(sample)).toBe(true);

    const hits = findInSources(/text-3xs\s+font-medium\s+tracking-wide\s+text-gray-500/);
    expect(hits, `分组小标题应改用 .group-label：\n${hits.join('\n')}`).toEqual([]);
  });

  it('Given 徽章已收口为 Chip / .chip / .count-pill When 再搜手写圆底徽章 Then 为零', () => {
    expect(/rounded-full\s+bg-(?:gray|accent)-/.test('className="rounded-full bg-gray-100"')).toBe(
      true
    );

    const hits = findInSources(/rounded-full\s+bg-(?:gray|accent)-/).filter(
      (hit) => !ALLOWED['徽章']!.some((file) => hit.startsWith(file))
    );
    expect(hits, `徽章应改用 Chip / .chip / .count-pill：\n${hits.join('\n')}`).toEqual([]);
  });

  it('Given 行内图标按钮已收口为 RowActionButton When 再搜裸 .row-action 按钮 Then 为零', () => {
    const pattern = /<button\b[\s\S]{0,400}?className=["'][^"']*\brow-action/;
    // 判据自测：单行与多行两种写法都必须命中（多行是历史漏检点，不能只测单行）。
    expect(pattern.test('<button className="row-action"')).toBe(true);
    expect(pattern.test('<button\n  type="button"\n  className="row-action close-site"\n>')).toBe(
      true
    );

    const hits = findAcrossLines(pattern);
    expect(hits, `行内图标按钮应改用 RowActionButton：\n${hits.join('\n')}`).toEqual([]);
  });
});

describe('组件一致性：收口用的语义类必须真实存在', () => {
  it('Given 组件依赖这些语义类 When 读 main.css Then 全部有定义', () => {
    for (const className of [
      '.group-label',
      '.input-row',
      '.input-line',
      '.row-action',
      '.chip',
      '.menu-item'
    ]) {
      expect(cssText, `main.css 缺少语义类 ${className}`).toContain(className);
    }
  });

  it('Given 输入框聚焦态改走 2px 单条线 When 读 main.css Then 不再叠 inset 指示条', () => {
    // 1px 边框 + inset -2px 同色叠层会渲染成约 3px 的实心底边，
    // 在 plain（强调色＝中性灰）主题下观感发闷 —— 已改为 border-bottom-width: 2px。
    expect(cssText).not.toMatch(/\.input-(?:row:focus-within|line:focus)[^{]*\{[^}]*inset 0 -2px/);
  });

  it('Given 超紧凑密度已上线 When 读 main.css Then 行 / 分区头 / 固定区 / 磁贴四处都有规则', () => {
    // 这条守卫的由来：首版 tight 只写了行内距，收藏夹头与置顶磁贴完全没变，
    // 上半屏看不出切换效果（用户实测反馈「没覆盖全」）。
    // 密度是**整块版面**的档位，不是单一组件的属性 —— 四个面都要跟着收。
    const surfaces: [string, RegExp][] = [
      ['行内留白', /\.row-item\.density-tight[\s\S]{0,120}?padding-top:\s*0/],
      ['分区头', /\[data-density='tight'\]\s+\.section-head\s*\{[\s\S]{0,120}?padding-top:\s*4px/],
      ['固定区容器', /\[data-density='tight'\]\s+\.fixed-area[\s\S]{0,160}?padding-top:\s*2px/],
      [
        '磁贴条留白',
        /\[data-density='tight'\]\s+\.pinned-strip\s*\{[\s\S]{0,120}?margin-bottom:\s*4px/
      ]
    ];
    for (const [label, pattern] of surfaces) {
      expect(pattern.test(cssText), `超紧凑缺少「${label}」规则`).toBe(true);
    }
  });

  it('Given 超紧凑密度 When 读 main.css Then 置顶磁贴保持 36px（不得随密度缩小）', () => {
    // 32px 磁贴会同时踩两个坑：16px 的「取消固定」角标占掉四分之一格（图标看起来没居中），
    // 且 4+32+4 的内容高与容器盒高差 1px，Chrome 会画出常驻滚动条。
    // 密度只收紧磁贴条的上下留白，不动磁贴本身。
    expect(cssText).not.toMatch(/\[data-density='tight'\]\s+\.pinned-tile\s*\{[^}]*width:\s*32px/);
  });
});
