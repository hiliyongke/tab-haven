/**
 * 主题色预设：色号 id 与展示色值的**唯一权威来源**。
 *
 * 此前同一份色号列表散落在四处（SettingsSchema 的 enum、ThemeApplier 的
 * ColorTheme 类型与 COLOR_THEMES 数组、设置页的色板）—— 新增一个色号要改四遍，
 * 漏改就会出现「设置里能选、主题不生效」这类难查的不一致。
 *
 * 放在 core 是因为它同时被 schema（core）、主题应用（platform）与设置页（UI）消费，
 * 任何更靠外的位置都会造成依赖倒挂。
 *
 * 展示文案（labelKey）不在此处：文案属于 UI 层，由设置页以
 * `Record<ColorTheme, string>` 承接，漏配会被类型检查拦下。
 */

export const COLOR_THEMES = [
  { id: 'forest', hex: '#347554' },
  { id: 'ocean', hex: '#3a6ea8' },
  { id: 'violet', hex: '#6f4ba6' },
  { id: 'sunset', hex: '#b85f22' },
  { id: 'mono', hex: '#4a524a' },
  { id: 'plain', hex: '#80868b' }
] as const;

/** 单个色号 id（'forest' | 'ocean' | ...）。 */
export type ColorTheme = (typeof COLOR_THEMES)[number]['id'];

/**
 * 色号 id 元组：供 `z.enum()` 使用。
 * zod 要求至少一项且为元组类型，故此处做一次收窄断言（`as const` 数组已保证内容）。
 */
export const COLOR_THEME_IDS = COLOR_THEMES.map((theme) => theme.id) as [
  ColorTheme,
  ...ColorTheme[]
];
