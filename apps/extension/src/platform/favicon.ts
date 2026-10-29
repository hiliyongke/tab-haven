import { browser } from 'wxt/browser';
import { isHttpUrl } from '@/core/url/UrlInspector';

/**
 * 站点图标地址构造：一律走浏览器 favicon 通道
 * `chrome-extension://<id>/_favicon/?pageUrl=<url>&size=<n>`（需 `favicon` 权限）。
 *
 * 直接渲染 `tab.favIconUrl`（第三方 URL）会是本扩展唯一的出站请求，且鉴权站点图标
 * 302 到登录页会产生约 25 跳直至 `ERR_TOO_MANY_REDIRECTS`。改用本地通道后三者一并消失：
 * 零第三方请求、无重定向风暴、无 Referer 泄露面。取不到时 UI 回退标题首字母。
 *
 * 落在 platform 让 `src/ui/**` 不直连浏览器 API：`browser.runtime.id` 属运行时信息。
 */

/** 32 是 Chrome 支持的最大档，缩到 16px 渲染不糊。 */
const FAVICON_SIZE = 32;

/**
 * 构造浏览器 favicon 通道地址。
 * 只接受 http(s)：`_favicon` 只认这类 URL，其余返回 null 走首字母回退，避免注定失败的请求。
 */
export function buildFaviconSrc(pageUrl: string | undefined): string | null {
  if (!isHttpUrl(pageUrl)) return null;
  return (
    `chrome-extension://${browser.runtime.id}/_favicon/` +
    `?pageUrl=${encodeURIComponent(pageUrl)}&size=${FAVICON_SIZE}`
  );
}
