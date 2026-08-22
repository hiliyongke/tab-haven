import { getDomain } from 'tldts';

/**
 * 站点身份（FR-D3.1 多级域名归组的核心数据结构）。
 *
 * 归组规则（与 Tabstead 基线语义对齐）：
 *  1. 仅 http/https 参与；
 *  2. hostname 小写、去 www 前缀、去尾点；
 *  3. localhost / .localhost / IP（v4、v6）：带端口整体为 key；
 *  4. 托管公共后缀清单（见下）：取三级域——实测 tldts 的 PSL 数据不包含
 *     这些"事实公共后缀"（github.io、vercel.app 等），需业务胶水清单兜底；
 *  5. 其余：tldts.getDomain 取注册域（eTLD+1），权威覆盖 PSL 全部条目，
 *     含国家复合后缀（.com.cn、.co.uk 等）。
 */
export interface SiteIdentity {
  /** 归组键：默认注册域；托管域为三级域；localhost/IP 场景为带端口主机。 */
  key: string;
  /** 展示标签，与 key 一致。 */
  label: string;
  /** 注册域（eTLD+1 或托管域三级）。 */
  registrableDomain: string;
  /** 子域部分（不含 www）；无子域时为空串。 */
  subdomain: string;
}

/** Tabstead 基线托管的公共后缀清单（PSL 盲区，实测 tldts 7.4 不覆盖）。 */
const HOSTED_PUBLIC_SUFFIXES = new Set([
  'blogspot.com',
  'firebaseapp.com',
  'github.io',
  'netlify.app',
  'notion.site',
  'pages.dev',
  'surge.sh',
  'vercel.app',
  'web.app',
  'wordpress.com'
]);

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

export function isIpAddress(hostname: string): boolean {
  return IPV4_RE.test(hostname) || hostname.includes(':');
}

export function siteIdentity(rawUrl: string): SiteIdentity | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!hostname) return null;

    if (isLocalhost(hostname) || isIpAddress(hostname)) {
      const key = url.port ? `${hostname}:${url.port}` : hostname;
      return { key, label: key, registrableDomain: hostname, subdomain: '' };
    }

    const labels = hostname.split('.');
    const lastTwoLabels = labels.slice(-2).join('.');
    if (labels.length > 2 && HOSTED_PUBLIC_SUFFIXES.has(lastTwoLabels)) {
      const domain = labels.slice(-3).join('.');
      return { key: domain, label: domain, registrableDomain: domain, subdomain: '' };
    }

    const domain = getDomain(hostname);
    if (!domain) return null;
    const subdomain =
      hostname === domain ? '' : hostname.slice(0, hostname.length - domain.length - 1);

    return { key: domain, label: domain, registrableDomain: domain, subdomain };
  } catch {
    return null;
  }
}
