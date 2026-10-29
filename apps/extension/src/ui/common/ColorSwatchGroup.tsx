import type { CSSProperties } from 'react';

/** 色板单选项：色值取自 `core/theme/colorThemes`（单一来源），文案由调用方补。 */
export interface ColorSwatchOption {
  value: string;
  /** 色号名，同时作为可访问名与鼠标提示。 */
  label: string;
  /**
   * 色值：以 `--swatch` 变量注入（main.css 的 .theme-swatch 用 var(--swatch) 取），
   * 不在 JSX 里写字面色值 —— 内联 `backgroundColor: '#hex'` 既绕开主题刻度，
   * 也无法被设计令牌守卫扫到。
   */
  hex: string;
}

/**
 * 互斥单选色板（主题色 / 分组色）。
 *
 * 语义走 `role="radiogroup"` + `role="radio"` + `aria-checked`：
 * CSS 选中态按 `[aria-checked='true']` 写，故不用原生 radio（它不输出该属性，选中环不显示）。
 *
 * 与 `SegmentedChip` 同族（同为互斥单选的一排小控件），只是形态是色块：
 * 视觉 20px / 命中 24px 由 `.theme-swatch` 的 ::after 保证。
 */
export function ColorSwatchGroup({
  label,
  value,
  options,
  onSelect,
  className
}: {
  /** 色板组的可访问名（如「主题色」）。 */
  label: string;
  /** 当前选中的 value。 */
  value: string;
  options: readonly ColorSwatchOption[];
  onSelect: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={'flex items-center gap-1.5' + (className ? ' ' + className : '')}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          title={option.label}
          className="theme-swatch"
          style={{ '--swatch': option.hex } as CSSProperties}
          onClick={() => onSelect(option.value)}
        />
      ))}
    </div>
  );
}
