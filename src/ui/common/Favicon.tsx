import { useEffect, useState } from 'react';

/** 站点图标：加载失败时回退为标题首字母（带背景的样式方框）。 */
export function Favicon({
  src,
  title,
  size = 16
}: {
  src?: string;
  title: string;
  size?: number;
}) {
  const fallback = (title || '?').trim().charAt(0).toUpperCase();
  const [broken, setBroken] = useState(false);

  // src 变化时重置失败态，避免复用旧的错误状态。
  useEffect(() => setBroken(false), [src]);

  if (!src || broken) {
    return (
      <span
        className="flex shrink-0 select-none items-center justify-center rounded bg-gray-200 text-[10px] font-semibold text-gray-500"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {fallback}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="shrink-0"
      style={{ width: size, height: size }}
      onError={() => setBroken(true)}
    />
  );
}
