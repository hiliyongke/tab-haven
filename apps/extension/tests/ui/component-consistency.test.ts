import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 组件结构行为规格：相同视觉形态使用一致的 class 组合，语义类在样式表中有定义；
 * 扫描判据需能识别对应源码形态。
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

/** 搜索源码 class 用法前移除注释内容。 */
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

/** 跨行搜索 JSX 属性，覆盖多行书写的 className。 */
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
  it('输入下划线样式只使用语义类，不重复手写 class 串', () => {
    // 判据自测：这三个样本必须被正则命中，否则说明正则已失效。
    expect(
      /border-b border-(gray-200|control|subtle)/.test('className="border-b border-gray-200"')
    ).toBe(true);

    const hits = findInSources(/border-b\s+border-(?:gray-200|control|subtle)/).filter(
      (hit) => !ALLOWED['下划线']!.some((file) => hit.startsWith(file))
    );
    expect(hits, `手写下划线串应改为 .input-row / .input-line：\n${hits.join('\n')}`).toEqual([]);
  });

  it('分组小标题样式不重复手写 class 串', () => {
    const sample = 'className="text-3xs font-medium tracking-wide text-gray-500"';
    expect(/text-3xs\s+font-medium\s+tracking-wide\s+text-gray-500/.test(sample)).toBe(true);

    const hits = findInSources(/text-3xs\s+font-medium\s+tracking-wide\s+text-gray-500/);
    expect(hits, `分组小标题应改用 .group-label：\n${hits.join('\n')}`).toEqual([]);
  });

  it('徽章样式不重复手写圆底 class 串', () => {
    expect(/rounded-full\s+bg-(?:gray|accent)-/.test('className="rounded-full bg-gray-100"')).toBe(
      true
    );

    const hits = findInSources(/rounded-full\s+bg-(?:gray|accent)-/).filter(
      (hit) => !ALLOWED['徽章']!.some((file) => hit.startsWith(file))
    );
    expect(hits, `徽章应改用 Chip / .chip / .count-pill：\n${hits.join('\n')}`).toEqual([]);
  });

  it('行内图标按钮统一使用 RowActionButton', () => {
    const pattern = /<button\b[\s\S]{0,400}?className=["'][^"']*\brow-action/;
    // 判据自测：单行与多行两种写法都必须命中。
    expect(pattern.test('<button className="row-action"')).toBe(true);
    expect(pattern.test('<button\n  type="button"\n  className="row-action close-site"\n>')).toBe(
      true
    );

    const hits = findAcrossLines(pattern);
    expect(hits, `行内图标按钮应改用 RowActionButton：\n${hits.join('\n')}`).toEqual([]);
  });
});

describe('组件一致性：收口用的语义类必须真实存在', () => {
  it('组件所需的语义类均在 main.css 中定义', () => {
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

  it('输入框聚焦态使用 2px 下边框，不叠加 inset 指示条', () => {
    // 聚焦状态通过 2px 下边框显示，不叠加 inset 阴影。
    expect(cssText).not.toMatch(/\.input-(?:row:focus-within|line:focus)[^{]*\{[^}]*inset 0 -2px/);
  });

  it('超紧凑密度为行、分区头、固定区和磁贴提供对应规则', () => {
    // 超紧凑密度同时影响行、分区头、固定区容器与磁贴条留白。
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

  it('超紧凑密度下置顶磁贴保持 36px', () => {
    // 超紧凑密度调整磁贴条留白，不改变置顶磁贴尺寸。
    expect(cssText).not.toMatch(/\[data-density='tight'\]\s+\.pinned-tile\s*\{[^}]*width:\s*32px/);
  });
});
