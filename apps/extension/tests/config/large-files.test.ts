import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 巨型文件行数棘轮：>600 行文件清单冻结，每个文件行数只许减、不许增。
 * 与 CODE-REVIEW.md 的 P1-8「文件 >600 行且净增 >50 行」互补：
 * 评审判据管单次改动，这里管长期存量与大文件清单扩散。
 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const THRESHOLD = 600;

/** 存量巨型文件的行数上限（取治理前实测值，或拆分后首次实测值）。 */
const CAPS: Record<string, number> = {
  'src/entrypoints/sidepanel/App.tsx': 1568,
  'src/stores/undoStore.ts': 1085,
  'src/entrypoints/options/settingSections.tsx': 684,
  'src/entrypoints/options/settingSectionsContent.tsx': 610,
  'src/platform/tabs.ts': 667,
  'src/entrypoints/options/SettingsPage.tsx': 664,
  'src/entrypoints/about/AboutPage.tsx': 650,
  'src/core/site/Sections.ts': 641,
  'src/entrypoints/background.ts': 628
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function linesOf(file: string): number {
  const text = readFileSync(file, 'utf8');
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function relative(file: string): string {
  return `src/${file.slice(SRC.length + 1).replaceAll('\\', '/')}`;
}

describe('巨型文件行数棘轮', () => {
  it('清单里的文件都还在（目录改名不会让守卫恒绿）', () => {
    expect(Object.keys(CAPS).length).toBeGreaterThan(0);
    for (const name of Object.keys(CAPS)) {
      expect(existsSync(join(SRC, name.slice(4))), `${name} 已不存在，请更新清单`).toBe(true);
    }
  });

  it('存量巨型文件行数只减不增，且没有清单外的新巨型文件', () => {
    // Given: 扫描全部源码（生成产物不是 .ts/.tsx，天然不在扫描面内）
    const large = walk(SRC)
      .map((file) => ({ name: relative(file), lines: linesOf(file) }))
      .filter((entry) => entry.lines > THRESHOLD);
    const byName = new Map(large.map((entry) => [entry.name, entry.lines]));

    // When: 逐项比对上限
    const grown = Object.entries(CAPS)
      .map(([name, cap]) => ({ name, cap, lines: byName.get(name) ?? 0 }))
      .filter((entry) => entry.lines > entry.cap);
    const added = large.filter((entry) => !(entry.name in CAPS));

    // Then: 巨型文件只能变小，清单不能变长
    expect(grown, '以下巨型文件行数超过上限').toEqual([]);
    expect(added, '出现了清单外的巨型文件').toEqual([]);
  });
});
