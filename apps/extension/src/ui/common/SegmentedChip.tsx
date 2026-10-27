import type { ReactNode } from 'react';

/**
 * 分段控件 chip（互斥单选：导入源切换、视图切换、工作区切换等二选一 / 多选一）。
 *
 * 语义：toggle 按钮 + `aria-pressed`，外层容器用 `role="group"` + `aria-label`。
 * 不用 `role="tablist"/"tab"`：后者要求配套的 tabpanel / aria-controls /
 * 方向键漫游 / roving tabindex，只实现一半时读屏被承诺「选项卡」却按不出行为
 * （工作区切换条 SpaceStrip 同口径）。
 *
 * 从 SnapshotsPanel 下沉到 ui/common：分段 + chip 排版是跨模块复用的形状
 * （SpaceStrip 的工作区 chips 是同一语义，只是胶囊 + 边框形态），锁在快照面板
 * 里会让第二处再抄一份 class 串、改命中下限必漏一处。
 *
 * 因此本组件同时承载两套形态，由 `shape` / `tone` 选择（此前是两处各写一串
 * class：圆角、transition、纵向内边距、选中态配色四项全不同，改一项必漏一项）：
 * - `shape`：rect = 方角小分段（导入源切换），pill = 胶囊（工作区切换条）；
 * - `tone`：neutral = 中性底选中（分段），brand = 品牌实底选中（工作区）。
 */
export function SegmentedChip({
  selected,
  onSelect,
  shape = 'rect',
  tone = 'neutral',
  tooltip,
  disabled,
  className,
  children
}: {
  /**
   * 选中态（`aria-pressed` 的原生分段语义）。
   * 不传则按普通按钮渲染（不落 aria-pressed）—— 例如「存为工作区」这类
   * 一次性入口复用同一形态，但它不是开关，标成未按下会误导读屏。
   */
  selected?: boolean;
  onSelect: () => void;
  /** rect = 方角（默认）；pill = 胶囊 + 边框。 */
  shape?: 'rect' | 'pill';
  /** neutral = 选中中性底（默认）；brand = 选中品牌实底。 */
  tone?: 'neutral' | 'brand';
  /** 悬停提示（chip 文字被截断时用它给全名）。 */
  tooltip?: string;
  disabled?: boolean;
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
