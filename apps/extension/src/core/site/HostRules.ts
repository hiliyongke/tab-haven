/**
 * 主机规则：把规范化主机名归类，供 SiteResolver 决定归组键的形态。
 *
 * 规则依据：
 *  - 本地主机（localhost / *.localhost）与 IP 地址：带端口整体作为归组键；
 *  - 托管公共后缀清单：这些"事实公共后缀"（github.io、vercel.app 等）不在
 *    Public Suffix List 数据中（实测 tldts 7.4 不覆盖），归组键取三级域。
 */

type HostKind = 'local' | 'ip' | 'public' | 'domain';

interface HostClassification {
  kind: HostKind;
  /** 命中托管清单时的后缀（如 github.io）；否则为 null。 */
  hostedSuffix: string | null;
}

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** 段值 0-255 校验：WHATWG URL 把 999.1.2.3 这类非法 IPv4 当域名解析，不能误判为 ip。 */
function isValidIpv4(hostname: string): boolean {
  return (
    IPV4_PATTERN.test(hostname) && hostname.split('.').every((segment) => Number(segment) <= 255)
  );
}

/** 托管公共后缀清单（业务规则，随产品版本维护）。 */
const HOSTED_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
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

/** 本机地址：`localhost` 及其子域。 */
export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

/**
 * 纯 IP 主机：IPv4 或含冒号的 IPv6（含方括号形式）。
 *
 * 入参必须是 **hostname（不含端口）**：`host:port` 形态里的冒号会被当成 IPv6
 * 判据而误判为 ip（进而被 `SiteResolver` 整体当作带端口的站点键）。调用方一律
 * 传 `url.hostname`；要判带端口的串请先用 `normalizeWhitelistHost` 之类的口径拆分。
 */
export function isIpHost(hostname: string): boolean {
  return isValidIpv4(hostname) || hostname.includes(':');
}

/**
 * 主机归类：local / ip / public（托管子域）/ 普通站点。
 * `hostedSuffix` 只在 public 时非空（如 `github.io`），供「同站点聚合」按托管域而非注册域分组。
 */
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

/**
 * 托管后缀下的站点键（如 `alice.github.io`）。
 *
 * 段数由 `hostedSuffix` 自身推导（后缀段数 + 1），不写死 3：清单里一旦出现
 * 单段托管后缀（未来可能的 `pages.dev` 变体或自建短域），`slice(-3)` 会把父域
 * 一并吞进来，把不同用户的站点聚成同一个 —— 这类错误只在聚合结果上可见，
 * 极难归因到这段取段逻辑。
 */
export function hostedSiteValue(hostname: string, hostedSuffix: string): string {
  const suffixLabels = hostedSuffix.split('.').length;
  return hostname
    .split('.')
    .slice(-(suffixLabels + 1))
    .join('.');
}
