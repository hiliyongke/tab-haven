import { useEffect, useState } from 'react';

/**
 * 图标地址白名单。
 *
 * `favIconUrl` 由被浏览页面提供（页面可控），固定条目与快照里的图标还可能来自
 * **导入的备份文件**。`<img src>` 不执行脚本，所以这里防的不是 XSS，而是两件事：
 *  1. 每个远端 favicon 都是扩展页主动发起的第三方出站请求，与「零出站网络请求」相悖；
 *  2. 默认会带上 Referer，等于告诉第三方站点「用户在用 Tabs、正在渲染这一行」。
 * 故只放行 http(s) 与内联 `data:image`，并为远端图标关掉 Referer。
 */
const SAFE_FAVICON_SRC = /^(?:https?:\/\/|data:image\/)/i;
/** 内联图标长度上限（32KB）：防止超大 data URL 撑爆渲染。 */
const MAX_DATA_URL_LENGTH = 32 * 1024;

function isSafeFaviconSrc(src: string): boolean {
  if (!SAFE_FAVICON_SRC.test(src)) return false;
  return src.startsWith('data:') ? src.length <= MAX_DATA_URL_LENGTH : true;
}

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

  if (!src || broken || !isSafeFaviconSrc(src)) {
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
    <img
      src={src}
      alt=""
      className="shrink-0"
      style={style}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}
