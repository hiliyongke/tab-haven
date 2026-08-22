/**
 * 站点聚合前后对比：左边是一屏散乱的标签，右边按域名收成两组。
 *
 * 画"前后"而不是只画"后"：用户对自己那一屏乱标签有体感，只给结果他认不出这是
 * 解决了什么问题。
 */
export function GroupBeforeAfter() {
  return (
    <svg className="art" viewBox="0 0 320 190" aria-hidden="true">
      {/* 前 */}
      <g>
        <rect x="6" y="8" width="140" height="174" rx="10" className="a-canvas" />
        <rect x="6" y="8" width="140" height="174" rx="10" fill="none" className="a-stroke-line" />
        <text x="18" y="28" fontSize="10" fontWeight="600" className="a-mute">
          before
        </text>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i} transform={`translate(18 ${38 + i * 22})`}>
            <rect width="10" height="10" rx="3" className="a-neutral-soft" />
            <rect x="16" y="3" width={i % 2 === 0 ? 92 : 70} height="4" rx="2" className="a-mute" />
            <rect x="16" y="9" width="44" height="3" rx="1.5" className="a-stroke-dim" />
          </g>
        ))}
      </g>

      {/* 箭头 */}
      <path d="M156 95h24" className="a-stroke-brand" />
      <path d="M176 89l6 6-6 6" fill="none" className="a-stroke-brand" />

      {/* 后 */}
      <g>
        <rect x="192" y="8" width="122" height="174" rx="10" className="a-canvas" />
        <rect
          x="192"
          y="8"
          width="122"
          height="174"
          rx="10"
          fill="none"
          className="a-stroke-line"
        />
        <text x="204" y="28" fontSize="10" fontWeight="600" className="a-brand">
          after
        </text>

        {/* 组 1：docs.example.com ×3 */}
        <g transform="translate(204 40)">
          <rect width="3" height="12" rx="1.5" className="a-brand" />
          <text x="10" y="10" fontSize="9" fontWeight="600" className="a-text">
            docs.example.com
          </text>
          <rect x="88" y="1" width="16" height="9" rx="4.5" className="a-brand-soft" />
          <text x="96" y="8" fontSize="8" fontWeight="700" textAnchor="middle" className="a-brand">
            3
          </text>
        </g>
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(206 ${58 + i * 18})`}>
            <rect width="9" height="9" rx="3" className="a-brand-dim" />
            <rect x="14" y="3" width="72" height="3.5" rx="1.75" className="a-text" />
          </g>
        ))}

        {/* 组 2：news.example.com ×2 */}
        <g transform="translate(204 122)">
          <rect width="3" height="12" rx="1.5" className="a-brand" />
          <text x="10" y="10" fontSize="9" fontWeight="600" className="a-text">
            news.example.com
          </text>
          <rect x="88" y="1" width="16" height="9" rx="4.5" className="a-brand-soft" />
          <text x="96" y="8" fontSize="8" fontWeight="700" textAnchor="middle" className="a-brand">
            2
          </text>
        </g>
        {[0, 1].map((i) => (
          <g key={i} transform={`translate(206 ${140 + i * 18})`}>
            <rect width="9" height="9" rx="3" className="a-brand-dim" />
            <rect x="14" y="3" width="62" height="3.5" rx="1.75" className="a-text" />
          </g>
        ))}
      </g>
    </svg>
  );
}
