import { useState } from 'react';
import { buildFaviconSrc } from '@/platform/favicon';

/**
 * 站点图标：地址由 `platform/favicon` 构造（浏览器本地 favicon 通道，
 * 需 `favicon` 权限），组件只负责展示与失败回退。
 */

/** 站点图标：加载失败时回退为标题首字母（带背景的样式方框）。
 *  cssSized 模式下不写 inline 尺寸，由调用方 CSS 接管（固定磁贴的 sm/md/lg 变体
 *  由此摆脱 !important 覆盖）。 */
export function Favicon({
  pageUrl,
  title,
  size = 16,
  cssSized = false
}: {
  /** 图标所属页面地址（不是图标地址）：图标由浏览器按页面 URL 现取。 */
  pageUrl?: string;
  title: string;
  size?: number;
  cssSized?: boolean;
}) {
  const fallback = (title || '?').trim().charAt(0).toUpperCase();
  /** 记录「哪个 src 加载失败」而非布尔失败态：src 变化即自动脱离失败态。 */
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const src = buildFaviconSrc(pageUrl);
  // 派生而非 effect：此前用 `useEffect(() => setBroken(false), [src])` 重置，
  // 会先渲染一轮旧的失败态再纠正（多一次渲染，且中间帧闪一下首字母方块）。
  // src 为 null 表示「无可用图标」，与 brokenSrc 初值同形，必须排除，否则无图标
  // 的条目会被误判成「加载失败」而永远走首字母回退。
  const broken = src !== null && brokenSrc === src;

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
    <img src={src} alt="" className="shrink-0" style={style} onError={() => setBrokenSrc(src)} />
  );
}
