/**
 * 主题色预设：色号 id 与展示色值的**唯一权威来源**，被 schema（core）、主题应用（platform）、设置页（UI）消费，故归 core 避免依赖倒挂。
 * 展示文案（labelKey）属 UI 层，由设置页以 `Record<ColorTheme, string>` 承接，漏配会被类型检查拦下。
 */

export const COLOR_THEMES = [
  { id: 'forest', hex: '#347554' },
  { id: 'ocean', hex: '#3a6ea8' },
  { id: 'violet', hex: '#6f4ba6' },
  { id: 'sunset', hex: '#b85f22' },
  { id: 'mono', hex: '#4a524a' },
  { id: 'plain', hex: '#80868b' }
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['id'];

/** 色号 id 元组：供 `z.enum()` 使用（zod 要求元组类型，故做一次收窄断言）。 */
export const COLOR_THEME_IDS = COLOR_THEMES.map((theme) => theme.id) as [
  ColorTheme,
  ...ColorTheme[]
];
