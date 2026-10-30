import { URL } from 'node:url';

const URL_PATTERN = /(?<![\w+./:-])(?:(https?|wss?):)?\/\/([^\s"'<>)]*)/gi;
const NETWORK_API_PATTERN =
  /(\bfetch\s*(?:\?\.)?\s*\(|\(\s*0\s*,\s*fetch\s*\)\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b)/g;

/** 查找构建产物中的网络 API 调用点。 */
export function findNetworkApis(text) {
  return [...text.matchAll(NETWORK_API_PATTERN)].map((match) => match[1]);
}

const NAMESPACE_REFERENCES = [
  { url: 'https://schema.org/', context: /["']@context["']\s*:\s*["']$/ },
  { url: 'http://www.w3.org/2000/svg', context: /\bxmlns\s*=\s*["']$/ },
  { url: 'http://www.w3.org/1999/xhtml', context: /\bxmlns:xhtml\s*=\s*["']$/ },
  {
    url: 'http://www.sitemaps.org/schemas/sitemap/0.9',
    context: /\bxmlns\s*=\s*["']$/
  }
];

function getSiteOrigin(siteUrl) {
  if (!siteUrl) return null;
  const url = new URL(siteUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('SITE_URL 必须是无凭据的 http(s) 根 URL');
  }
  return url.origin;
}

export function findExternalUrls(text, siteUrl = '') {
  const siteOrigin = getSiteOrigin(siteUrl);
  const external = [];

  for (const match of text.matchAll(URL_PATTERN)) {
    const protocol = match[1]?.toLowerCase();
    const rawUrl = match[2];
    if (!rawUrl) continue;

    let url;
    try {
      url = new URL(protocol ? `${protocol}://${rawUrl}` : `https://${rawUrl}`);
    } catch {
      external.push(rawUrl);
      continue;
    }

    const prefix = text.slice(0, match.index);
    const isNamespace =
      protocol !== undefined &&
      NAMESPACE_REFERENCES.some(
        (reference) => reference.url === url.href && reference.context.test(prefix)
      );
    const isSameSite =
      siteOrigin !== null &&
      url.username === '' &&
      url.password === '' &&
      !['ws:', 'wss:'].includes(url.protocol) &&
      url.origin === siteOrigin;

    if (!isNamespace && !isSameSite) external.push(url.host);
  }

  return external;
}
