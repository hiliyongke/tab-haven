import { describe, expect, it } from 'vitest';
import { COLOR_THEMES, COLOR_THEME_IDS, type ColorTheme } from '@/core/theme/colorThemes';

/**
 * 主题色号由 `core/theme/colorThemes` 唯一提供；色板 id、色值与设置校验使用的
 * `COLOR_THEME_IDS` 保持一致。
 */

describe('COLOR_THEMES 色号表', () => {
  it('色号 id 唯一', () => {
    const ids = COLOR_THEMES.map((theme) => theme.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个色号都带合法的 6 位十六进制色值', () => {
    expect(COLOR_THEMES.length).toBeGreaterThan(0);
    for (const theme of COLOR_THEMES) {
      expect(theme.hex, `${theme.id} 的色值不合法`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('主题色值两两不同', () => {
    const hexes = COLOR_THEMES.map((theme) => theme.hex.toLowerCase());

    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('包含 plain 作为默认色号（不传色号时的落盘值）', () => {
    expect((COLOR_THEMES.map((theme) => theme.id) as ColorTheme[]).includes('plain')).toBe(true);
  });
});

describe('COLOR_THEME_IDS 色号列表', () => {
  it('与 COLOR_THEMES 的 id 逐项同序（顺序即设置页色板的展示顺序）', () => {
    expect(COLOR_THEME_IDS).toEqual(COLOR_THEMES.map((theme) => theme.id));
  });

  it('色号列表至少包含一项', () => {
    expect(COLOR_THEME_IDS.length).toBeGreaterThan(0);
  });
});
