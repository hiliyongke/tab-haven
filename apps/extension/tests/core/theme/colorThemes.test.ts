import { describe, expect, it } from 'vitest';
import { COLOR_THEMES, COLOR_THEME_IDS, type ColorTheme } from '@/core/theme/colorThemes';

/**
 * 主题色号的唯一权威来源（`core/theme/colorThemes`）。
 *
 * 这个文件此前没有测试：它是纯常量模块，看起来「不需要测」，但正因为它是
 * **唯一来源**，它一旦漂移（色号 id 重复、hex 写错、`COLOR_THEME_IDS` 与
 * `COLOR_THEMES` 不同步），schema 的 `z.enum()` 与设置页的色板会同时失准，
 * 而症状是「设置里能选、主题不生效」——极难归因。
 */

describe('COLOR_THEMES 色号表', () => {
  it('色号 id 唯一（重复 id 会让色板与 enum 同时对不上）', () => {
    const ids = COLOR_THEMES.map((theme) => theme.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个色号都带合法的 6 位十六进制色值', () => {
    expect(COLOR_THEMES.length).toBeGreaterThan(0);
    for (const theme of COLOR_THEMES) {
      expect(theme.hex, `${theme.id} 的色值不合法`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('hex 值两两不同（两个色号同色等于多了一个无效选项）', () => {
    const hexes = COLOR_THEMES.map((theme) => theme.hex.toLowerCase());

    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('包含 plain 作为默认色号（不传色号时的落盘值）', () => {
    expect((COLOR_THEMES.map((theme) => theme.id) as ColorTheme[]).includes('plain')).toBe(true);
  });
});

describe('COLOR_THEME_IDS（供 schema 的 z.enum 使用）', () => {
  it('与 COLOR_THEMES 的 id 逐项同序（顺序即设置页色板的展示顺序）', () => {
    expect(COLOR_THEME_IDS).toEqual(COLOR_THEMES.map((theme) => theme.id));
  });

  it('至少一项（zod 的 z.enum 不接受空元组）', () => {
    expect(COLOR_THEME_IDS.length).toBeGreaterThan(0);
  });
});
