/**
 * DevTools 的 Network 面板示意：请求数为 0。
 *
 * 这是「零出站网络请求」最直观的一张图 —— 比任何一句承诺都好使。面板里的
 * `Network` / `0 requests` 是 Chrome DevTools 的真实英文文案，两种语言下都不翻译
 * （翻译了反而不像 DevTools，也会让「自己去验证」这件事对不上号）。
 */
export function DevtoolsZero() {
  return (
    <svg
      className="art"
      viewBox="0 0 220 132"
      role="img"
      aria-label="DevTools Network panel: 0 requests"
    >
      <rect x="0.9" y="0.9" width="218.2" height="130.2" rx="12" className="a-surface" />
      <rect
        x="0.9"
        y="0.9"
        width="218.2"
        height="130.2"
        rx="12"
        fill="none"
        className="a-stroke-line"
      />

      {/* 面板标题栏 */}
      <path d="M1 25h218" className="a-stroke-line" />
      <circle cx="16" cy="13" r="3" className="a-mute" />
      <text x="28" y="17" fontSize="10" fontWeight="600" className="a-text">
        Network
      </text>
      <text x="150" y="17" fontSize="9" className="a-mute">
        Service Worker
      </text>

      {/* 结果区：空列表 + 居中的 0 requests */}
      <rect x="12" y="34" width="196" height="88" rx="8" className="a-canvas" />
      <rect x="12" y="34" width="196" height="88" rx="8" fill="none" className="a-stroke-line" />
      <circle cx="110" cy="72" r="19" className="a-brand-soft" />
      <text x="110" y="76" fontSize="12" fontWeight="700" textAnchor="middle" className="a-brand">
        0
      </text>
      <text x="110" y="102" fontSize="10" textAnchor="middle" className="a-text">
        requests
      </text>

      {/* 底部：无请求、无上传量的三条占位（刻意留空 = 真的没有） */}
      <path d="M22 46h44M22 58h30" className="a-stroke-dim" strokeWidth="1.4" />
    </svg>
  );
}
