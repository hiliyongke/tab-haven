/**
 * 品牌标记：与扩展 `public/icon/logo-light.svg` 同一几何（斜体 T + 长腿 + 奶油黄点）。
 *
 * 写成 JSX 而不是 `?raw` 导入 + `dangerouslySetInnerHTML`：项目红线禁止动态 HTML 注入，
 * 而内联 SVG 本就是 React 的原生表达方式。渐变 id 带后缀，避免同页多处渲染时互相覆盖。
 *
 * 注意这是 logo 的**第三份拷贝**（另两份是 `public/icon/logo.svg`、`logo-light.svg`
 * 与 `site/public/icon.svg` favicon）：改配色要三处同步，别只改一处。
 */
export interface BrandMarkProps {
  size?: number;
  /** 同页多处渲染时传入，保证渐变 id 唯一 */
  idSuffix?: string;
  className?: string;
}

export function BrandMark({ size = 32, idSuffix = '', className }: BrandMarkProps) {
  const bg = `tabs-logo-bg${idSuffix}`;
  const bar = `tabs-logo-bar${idSuffix}`;
  const stem = `tabs-logo-stem${idSuffix}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF6E9" />
          <stop offset="100%" stopColor="#FFE7DF" />
        </linearGradient>
        <linearGradient id={bar} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FF8A75" />
          <stop offset="100%" stopColor="#FF6B5B" />
        </linearGradient>
        <linearGradient id={stem} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF7A6B" />
          <stop offset="100%" stopColor="#F5665A" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill={`url(#${bg})`} />
      <g transform="translate(64 64) skewX(10) translate(-64 -64)">
        <rect x="48" y="45" width="32" height="70" rx="9" fill={`url(#${stem})`} />
        <rect x="14" y="25" width="100" height="28" rx="14" fill={`url(#${bar})`} />
        <circle cx="106" cy="16" r="9" fill="#FFC94D" />
      </g>
    </svg>
  );
}
