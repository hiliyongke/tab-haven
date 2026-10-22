import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 守护主题镜像键的单一口径。
 *
 * `theme-init.ts` 在 React 之前同步执行，按约定**不做运行时 import**（只用
 * `import type`），因此它把 `platform/theme/ThemeApplier.ts` 的两个镜像键名
 * 内联了一份。这份复制是刻意的，但复制即漂移风险：改了写入侧忘了改读取侧，
 * 表现为「设置里换主题，刷新后首帧仍回旧色」——只在首屏闪一下，极难归因。
 *
 * 这里不试图消除复制（那要违反防闪烁的同步约束），而是让复制**必须对齐**：
 * 两侧键名不一致即失败。
 */

const srcRoot = fileURLToPath(new URL('../../src/', import.meta.url));

/** 取出文件里所有 `tabs…` 字面量（两个文件都不含其它 tabs 前缀字面量）。 */
function tabsLiterals(file: string): string[] {
  const text = readFileSync(`${srcRoot}${file}`, 'utf8');
  return [...text.matchAll(/['"](tabs[.:][a-zA-Z0-9._-]+)['"]/g)].map((match) => match[1]!);
}

describe('主题镜像键（theme-init ↔ ThemeApplier）', () => {
  it('theme-init 内联的键名与 ThemeApplier 写入的键名逐项一致', () => {
    // Given: 两侧文件里的 tabs 前缀字面量
    const written = tabsLiterals('platform/theme/ThemeApplier.ts');
    const readBack = tabsLiterals('theme-init.ts');

    // When/Then: 读取侧不得引用写入侧没有的键，也不得漏读任何一个
    expect(written.length).toBeGreaterThan(0);
    expect([...readBack].sort()).toEqual([...written].sort());
  });
});
