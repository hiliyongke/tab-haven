import type { ReactNode } from 'react';

/**
 * 分段控件 chip（互斥单选：导入源切换、视图切换等二选一 / 多选一）。
 *
 * 语义：toggle 按钮 + `aria-pressed`，外层容器用 `role="group"` + `aria-label`。
 * 不用 `role="tablist"/"tab"`：后者要求配套的 tabpanel / aria-controls /
 * 方向键漫游 / roving tabindex，只实现一半时读屏被承诺「选项卡」却按不出行为
 * （工作区切换条 SpaceStrip 同口径）。
 *
 * 从 SnapshotsPanel 下沉到 ui/common：分段 + chip 排版是跨模块复用的形状
 * （SpaceStrip 的工作区 chips 是同一语义，只是胶囊 + 边框形态），锁在快照面板
 * 里会让第二处再抄一份 class 串、改命中下限必漏一处。
 */
export function SegmentedChip({
  selected,
  onSelect,
  children
}: {
  /** 选中态（`aria-pressed` 的原生分段语义）。 */
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      // py-1.5：py-1 + 10px 字仅 23px，低于 24px 命中下限
      className={
        'chip chip--cjk rounded px-2 py-1.5 font-medium transition-base ' +
        (selected ? 'bg-surface text-gray-800 elev-1' : 'text-gray-500 hover:text-gray-700')
      }
      onClick={onSelect}
    >
      {children}
    </button>
  );
}
