/**
 * 重复治理与休眠：左侧三行带着"重复"徽章，右侧只剩一行 + 一枚休眠雪花。
 *
 * 两件事画在一张里是有意的：去重与休眠在这个产品里是同一个动作组
 * （「重复治理与休眠」），拆成两张反而看不出关联。
 */
export function CleanupArt() {
  return (
    <svg className="art" viewBox="0 0 300 190" aria-hidden="true">
      {/* 清理前 */}
      <rect x="8" y="18" width="122" height="140" rx="10" className="a-canvas" />
      <rect x="8" y="18" width="122" height="140" rx="10" fill="none" className="a-stroke-line" />
      <text x="20" y="38" fontSize="10" fontWeight="600" className="a-mute">
        duplicates
      </text>

      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(20 ${50 + i * 30})`}>
          <rect width="12" height="12" rx="3" className="a-warn-soft" />
          <rect x="18" y="4" width="62" height="4" rx="2" className="a-mute" />
          {/* 重复计数徽章 */}
          <rect x="86" y="0" width="24" height="12" rx="6" className="a-warn-soft" />
          <text x="98" y="9" fontSize="8" fontWeight="700" textAnchor="middle" className="a-warn">
            3×
          </text>
        </g>
      ))}
      <text x="20" y="146" fontSize="9" className="a-mute">
        3 tabs, 1 url
      </text>

      {/* 箭头 */}
      <path d="M140 88h26" className="a-stroke-brand" />
      <path d="M160 82l6 6-6 6" fill="none" className="a-stroke-brand" />

      {/* 清理后：保留 1 个 + 其余休眠 */}
      <rect x="176" y="18" width="116" height="140" rx="10" className="a-canvas" />
      <rect x="176" y="18" width="116" height="140" rx="10" fill="none" className="a-stroke-line" />
      <text x="188" y="38" fontSize="10" fontWeight="600" className="a-brand">
        cleaned
      </text>

      <g transform="translate(188 52)">
        <rect width="12" height="12" rx="3" className="a-brand" />
        <rect x="18" y="4" width="62" height="4" rx="2" className="a-text" />
      </g>

      {/* 休眠的两枚：灰掉 + 雪花 */}
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(188 ${84 + i * 26})`} opacity="0.72">
          <rect width="12" height="12" rx="3" className="a-neutral-soft" />
          <rect x="18" y="4" width="52" height="4" rx="2" className="a-mute" />
          <g transform="translate(80 2)" className="a-stroke-mute" strokeWidth="1.4">
            <path d="M6 0v12M0.5 3l11 6M11.5 3l-11 6M1.5 1.5l9 9M10.5 1.5l-9 9" />
          </g>
        </g>
      ))}

      <text x="188" y="146" fontSize="9" className="a-mute">
        hibernated
      </text>
    </svg>
  );
}
