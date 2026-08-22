/**
 * 撤销栈示意：最近的操作叠在上面，一支回退箭头把它们一层层拨回来。
 *
 * 刻意画出"多层"而不是一个 undo 图标 —— 卖点是「栈深 10、可分批恢复」，
 * 单个循环箭头传达不出这个差别。
 */
export function UndoStackArt() {
  const depth = 5;
  return (
    <svg className="art" viewBox="0 0 300 190" aria-hidden="true">
      {/* 栈：越靠上越新，用品牌色深浅表达"最近" */}
      {[...Array(depth)].map((_, i) => {
        const index = depth - 1 - i;
        const y = 16 + index * 20;
        const x = 74 + index * 8;
        const opacity = 1 - index * 0.13;
        return (
          <g key={index} opacity={opacity}>
            <rect x={x} y={y} width="150" height="16" rx="5" className="a-brand-soft" />
            <rect
              x={x}
              y={y}
              width="150"
              height="16"
              rx="5"
              fill="none"
              className="a-stroke-brand"
            />
            <rect
              x={x + 10}
              y={y + 6}
              width={70 - index * 6}
              height="4"
              rx="2"
              className="a-brand"
            />
          </g>
        );
      })}

      {/* 回退箭头：从栈顶绕回栈底 */}
      <path
        d="M224 30c26 0 34 18 34 40v34c0 22-12 36-34 36h-58"
        fill="none"
        className="a-stroke-brand"
      />
      <path d="M152 128l14-12 14 12" fill="none" className="a-stroke-brand" />

      {/* 被恢复的目标：一个已还原的标签 */}
      <rect x="30" y="118" width="106" height="34" rx="8" className="a-canvas" />
      <rect x="30" y="118" width="106" height="34" rx="8" fill="none" className="a-stroke-line" />
      <rect x="40" y="128" width="10" height="10" rx="3" className="a-brand" />
      <rect x="56" y="130" width="62" height="4" rx="2" className="a-text" />
      <rect x="56" y="138" width="38" height="3" rx="1.5" className="a-mute" />

      {/* 栈深标注 */}
      <text x="74" y="178" fontSize="10" className="a-mute">
        depth 10
      </text>
    </svg>
  );
}
