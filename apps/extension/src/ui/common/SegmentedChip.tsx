import type { ReactNode } from 'react';

/**
 * 分段控件 chip（互斥单选：导入源/视图/工作区切换）。toggle 按钮 + `aria-pressed`，
 * 外层容器用 `role="group"` + `aria-label`；不用 role="tablist"/"tab"（那要求配套
 * tabpanel/方向键漫游/roving tabindex，只实现一半会误导读屏）。
 * 同时承载两套形态，由 `shape`/`tone` 选择，收口圆角/内距/选中态配色只此一处。
 */
export function SegmentedChip({
  selected,
  onSelect,
  shape = 'rect',
  tone = 'neutral',
  tooltip,
  disabled,
  autoFocus,
  className,
  children
}: {
  /** 选中态（`aria-pressed`）。不传则按普通按钮渲染（不落 aria-pressed）—— 一次性入口
   *  （如「存为工作区」）不是开关，标成未按下会误导读屏。 */
  selected?: boolean;
  onSelect: () => void;
  /** rect = 方角（默认）；pill = 胶囊 + 边框。 */
  shape?: 'rect' | 'pill';
  /** neutral = 选中中性底（默认）；brand = 选中品牌实底。 */
  tone?: 'neutral' | 'brand';
  /** 悬停提示（chip 文字被截断时用它给全名）。 */
  tooltip?: string;
  disabled?: boolean;
  /** 挂载即聚焦：视图切换后把键盘焦点带进新内容首项（避免触发按钮卸载后焦点掉 body）。 */
  autoFocus?: boolean;
  /** 附加类（末尾拼接，与 Button 同口径）。 */
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={tooltip}
      disabled={disabled}
      autoFocus={autoFocus}
      // py 由 shape 决定：rect 用 py-1.5（py-1 + 10px 字仅 23px，低于 24px 命中下限），
      // pill 自带边框高度，py-1 已够。
      className={
        'chip chip--cjk font-medium transition-base disabled:opacity-50 ' +
        (shape === 'pill' ? 'rounded-full border px-2 py-1' : 'rounded px-2 py-1.5') +
        (tone === 'brand'
          ? selected
            ? ' border-accent-500 bg-accent-500 text-on-accent hover:bg-accent-600'
            : ' border-gray-200 bg-surface text-gray-600 hover:bg-gray-50'
          : selected
            ? ' bg-surface text-gray-800 elev-1'
            : ' text-gray-500 hover:text-gray-700') +
        (className ? ' ' + className : '')
      }
      onClick={onSelect}
    >
      {children}
    </button>
  );
}
