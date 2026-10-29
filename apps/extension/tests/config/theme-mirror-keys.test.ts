import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** theme-init 首帧读取的主题键与 ThemeApplier 写入的主题键保持一致。 */

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
