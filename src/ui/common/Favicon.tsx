import { useEffect, useState } from 'react';

/** 站点图标：加载失败时回退为标题首字母（带背景的样式方框）。
 *  cssSized 模式下不写 inline 尺寸，由调用方 CSS 接管（固定磁贴的 sm/md/lg 变体
 *  由此摆脱 !important 覆盖）。 */
export function Favicon({
  src,
  title,
  size = 16,
  cssSized = false
}: {
  src?: string;
  title: string;
  size?: number;
  cssSized?: boolean;
}) {
  const fallback = (title || '?').trim().charAt(0).toUpperCase();
  const [broken, setBroken] = useState(false);

  // src 变化时重置失败态，避免复用旧的错误状态。
  useEffect(() => setBroken(false), [src]);

  const style = cssSized ? undefined : { width: size, height: size };

  if (!src || broken) {
    return (
      <span
        className="flex shrink-0 select-none items-center justify-center rounded bg-gray-200 text-2xs font-semibold text-gray-600"
        style={style}
        aria-hidden="true"
      >
        {fallback}
      </span>
    );
  }

  return (
    <img src={src} alt="" className="shrink-0" style={style} onError={() => setBroken(true)} />
  );
}
