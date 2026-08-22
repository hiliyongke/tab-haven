/**
 * 数据流转图：标签 → 侧边栏（本机）↔ chrome.storage.local，通往云端的那条线被划掉。
 *
 * 图里的标识符都是真实名称（chrome.storage.local / no server），两种语言下都不翻译：
 * 用户要拿着这张图去自己的 DevTools 里对照，翻译过就对不上了。
 */
export function DataFlowArt() {
  return (
    <svg className="art" viewBox="0 0 340 200" aria-hidden="true">
      {/* 浏览器标签 */}
      <rect x="8" y="30" width="86" height="92" rx="10" className="a-canvas" />
      <rect x="8" y="30" width="86" height="92" rx="10" fill="none" className="a-stroke-line" />
      <text x="20" y="50" fontSize="9" fontWeight="600" className="a-text">
        browser tabs
      </text>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(18 ${60 + i * 18})`}>
          <rect width="10" height="10" rx="3" className={i === 1 ? 'a-brand' : 'a-neutral-soft'} />
          <rect x="15" y="3" width={44 - i * 6} height="4" rx="2" className="a-mute" />
        </g>
      ))}
      <text x="20" y="114" fontSize="8" className="a-mute">
        this window
      </text>

      {/* 标签 → 侧边栏 */}
      <path d="M100 76h30" className="a-stroke-brand" />
      <path d="M124 70l6 6-6 6" fill="none" className="a-stroke-brand" />

      {/* 侧边栏（本产品） */}
      <rect x="136" y="24" width="94" height="104" rx="10" className="a-brand-soft" />
      <rect x="136" y="24" width="94" height="104" rx="10" fill="none" className="a-stroke-brand" />
      <text x="148" y="44" fontSize="10" fontWeight="700" className="a-brand">
        Tabs
      </text>
      <text x="148" y="58" fontSize="8" className="a-text">
        side panel
      </text>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(148 ${68 + i * 18})`}>
          <rect width="10" height="10" rx="3" className="a-brand-dim" />
          <rect x="15" y="3" width="50" height="4" rx="2" className="a-brand" />
        </g>
      ))}

      {/* 侧边栏 ↔ 本机存储（双向） */}
      <path d="M236 64h32" className="a-stroke-control" />
      <path d="M262 58l6 6-6 6" fill="none" className="a-stroke-control" />
      <path d="M268 88h-32" className="a-stroke-control" />
      <path d="M242 82l-6 6 6 6" fill="none" className="a-stroke-control" />

      {/* 本机存储 */}
      <rect x="274" y="30" width="58" height="92" rx="10" className="a-canvas" />
      <rect x="274" y="30" width="58" height="92" rx="10" fill="none" className="a-stroke-line" />
      <rect x="288" y="44" width="30" height="26" rx="4" className="a-neutral-soft" />
      <rect x="288" y="76" width="30" height="8" rx="4" className="a-neutral-soft" />
      <rect x="288" y="90" width="30" height="8" rx="4" className="a-neutral-soft" />
      <text x="303" y="118" fontSize="7" textAnchor="middle" className="a-text">
        storage.local
      </text>

      {/* 被划掉的"→ 云端" */}
      <g transform="translate(120 148)">
        <path d="M0 26h96" className="a-stroke-dim dashed" />
        <path d="M96 20l7 6-7 6" fill="none" className="a-stroke-dim" />
        {/* 云朵轮廓 */}
        <path
          d="M112 26a10 10 0 0 1 10-10a12 12 0 0 1 22 4a9 9 0 0 1 3 17h-30a8 8 0 0 1-5-11z"
          className="a-stroke-dim"
        />
        {/* 划掉 */}
        <path d="M-4 4l150 44" className="a-stroke-red" strokeWidth="2" />
        <text x="122" y="60" fontSize="9" fontWeight="700" className="a-red-soft">
          no server
        </text>
      </g>
    </svg>
  );
}
