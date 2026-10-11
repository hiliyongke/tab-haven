import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

/**
 * 站点图标：一律走浏览器自己的 favicon 通道
 * `chrome-extension://<id>/_favicon/?pageUrl=<url>&size=<n>`（需 `favicon` 权限）。
 *
 * 此前直接把 `tab.favIconUrl`（被浏览站点自己的 URL）渲染进 `<img src>`，那是本产品
 * **唯一的第三方出站请求**，且带来两个实际问题：
 *  1. 鉴权站点的图标地址会 302 到登录页再跳回来，一次渲染产生约 25 跳，最终
 *     `ERR_TOO_MANY_REDIRECTS` —— 用户看到的是少一个图标，代价是 25 次外部请求；
 *  2. 即便关掉 Referer，请求本身仍由扩展页发起，与「零出站」的对外口径冲突。
 *
 * 改用浏览器本地 favicon 库后三者一并消失：零第三方请求、无重定向风暴、也不存在
 * Referer 泄露面。图标取不到（站点无图标 / 权限未授予 / 非 http(s) 页面）时
 * 回退为标题首字母。
 */

/** 取图尺寸：32 是 Chrome 支持的最大档，缩到 16px 渲染不糊。 */
const FAVICON_SIZE = 32;

/**
 * 构造浏览器 favicon 通道地址。
 *
 * 只接受 http(s) 页面：`_favicon` 只认这类 URL，其余（chrome:// / about:blank /
 * 空值）一律返回 null 走首字母回退，避免发出注定失败的请求。
 */
function buildFaviconSrc(pageUrl: string | undefined): string | null {
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return null;
  return (
    `chrome-extension://${browser.runtime.id}/_favicon/` +
    `?pageUrl=${encodeURIComponent(pageUrl)}&size=${FAVICON_SIZE}`
  );
}

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
  const [broken, setBroken] = useState(false);
  const src = buildFaviconSrc(pageUrl);

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
