import { domainToUnicode } from '@/core/url/punycode';

/**
 * 归组键：站点身份标识。三种形态（由 SiteResolver 按主机类型产出）：
 * 注册域（eTLD+1）／托管域三级（user.github.io）／本地·IP 带端口主机（localhost:3000）。
 *
 * 本模块是「站点展示标签 / 分桶键」的唯一口径，收口以避免各调用点漏掉「空子域保留端口」约束。
 */

export interface SiteKey {
  /** 归组标识（比较与聚合用）。 */
  value: string;
  /** 展示标签（默认与 value 一致）。 */
  label: string;
  /** 注册域；本地/IP 场景为原始主机。 */
  registrableDomain: string;
  /** 子域部分（不含 www）；无子域为空串。 */
  subdomain: string;
}

/** 分组展示标签：裸域为注册域，否则 "子域.注册域"。 */
export function subLabel(subdomain: string, registrableDomain: string): string {
  return subdomain ? `${subdomain}.${registrableDomain}` : registrableDomain;
}

/**
 * 站点键 → 展示标签（建组标题 / 同站点判定的唯一口径）。
 *
 * 子域为空（裸域 / 本地 / IP）沿用解析器原始 value **保留端口**：
 * `SiteResolver` 对 local/ip 给出的 `registrableDomain` 不含端口，
 * 一律走 `subLabel` 会让 localhost:3000 与 localhost:8080 变同一标签而错误合并。
 */
export function siteValueOf(site: SiteKey): string {
  return site.subdomain === '' ? site.value : subLabel(site.subdomain, site.registrableDomain);
}

export function siteLabelOf(site: SiteKey): string {
  return domainToUnicode(siteValueOf(site));
}

/**
 * 站点桶键（分桶 / 同站点比较的唯一口径）：value + 子域。
 * 用 \u0000 分隔：裸域 example.com（子域空）与 m.example.co（value=example.co）拼接键相同，会混进同一分区。
 */
export function siteBucketId(site: SiteKey): string {
  return `${site.value}\u0000${site.subdomain}`;
}
