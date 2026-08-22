/**
 * 主机规则：把规范化主机名归类，供 SiteResolver 决定归组键的形态。
 *
 * 规则依据（产品行为规格，见 PRD 附录 C-4）：
 *  - 本地主机（localhost / *.localhost）与 IP 地址：带端口整体作为归组键；
 *  - 托管公共后缀清单：这些"事实公共后缀"（github.io、vercel.app 等）不在
 *    Public Suffix List 数据中（实测 tldts 7.4 不覆盖），归组键取三级域。
 */

export type HostKind = 'local' | 'ip' | 'public' | 'domain';

export interface HostClassification {
  kind: HostKind;
  /** 命中托管清单时的后缀（如 github.io）；否则为 null。 */
  hostedSuffix: string | null;
}

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** 托管公共后缀清单（业务规则，随产品版本维护）。 */
export const HOSTED_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
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

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

export function isIpHost(hostname: string): boolean {
  return IPV4_PATTERN.test(hostname) || hostname.includes(':');
}

export function classifyHost(hostname: string): HostClassification {
  if (isLocalHost(hostname)) return { kind: 'local', hostedSuffix: null };
  if (isIpHost(hostname)) return { kind: 'ip', hostedSuffix: null };

  const labels = hostname.split('.');
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length > 2 && HOSTED_PUBLIC_SUFFIXES.has(lastTwo)) {
    return { kind: 'public', hostedSuffix: lastTwo };
  }
  return { kind: 'domain', hostedSuffix: null };
}
