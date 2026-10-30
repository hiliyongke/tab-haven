import { useRef, type CSSProperties, type KeyboardEvent } from 'react';

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
  // radiogroup 键盘契约：方向键在色块间移动并即选（radio 的惯例），Home/End 跳首尾。
  // 用 ref 数组在切换后主动聚焦目标项 —— 焦点不跟随则方向键只在原地反复 onSelect。
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (options.length === 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + options.length) % options.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = options.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onSelect(option.value);
    // onSelect 触发受控更新会重排 roving tabindex；本 tick 内直接聚焦目标项即可，
    // 不必等重渲染（该按钮始终存在于 DOM，只是 tabindex 变化）。
    itemRefs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={'flex items-center gap-1.5' + (className ? ' ' + className : '')}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          title={option.label}
          /* roving tabindex：整组只有一个 Tab 停靠点（选中项），其余靠方向键到达。
             无匹配 value 时首个选项兜底可聚焦，避免全组 -1 导致键盘完全不可达。 */
          tabIndex={index === selectedIndex ? 0 : -1}
          className="theme-swatch"
          style={{ '--swatch': option.hex } as CSSProperties}
          onClick={() => onSelect(option.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        />
      ))}
    </div>
  );
}
