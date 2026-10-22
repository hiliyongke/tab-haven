import { domainToUnicode } from '@/core/url/punycode';

/**
 * 归组键：站点的身份标识（同一键的标签归入同一虚拟站点组）。
 *
 * 键的三种形态（由 SiteResolver 依据主机类型产出）：
 *  - 注册域（eTLD+1，如 example.com）
 *  - 托管域三级（如 user.github.io）
 *  - 本地/IP 带端口主机（如 localhost:3000）
 *
 * 本模块同时是「站点展示标签 / 分桶键」的**唯一口径**：这两个派生量此前在
 * AutoGrouping、Sections、SiteGrouping 各处各写一份（其中一份还自封"唯一口径"），
 * 实际是 4 份互不约束的拷贝 —— 任一处漏掉"空子域保留端口"这条约束，就会把
 * localhost:3000 与 localhost:8080 判成同一站点且无人察觉。收口到键的定义处后，
 * 改口径只有一处可改。
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
 * 站点键 → 站点展示标签（建组标题 / 同站点判定的**唯一口径**）。
 *
 * 子域非空用「子域.注册域」，子域为空（裸域 / 本地 / IP）沿用解析器原始 value
 * （**保留端口**）—— 与 `aggregateBySite` 的 groupKey 同口径。
 *
 * 保留端口不是可选项：`SiteResolver` 对 local/ip 站点给出的 `registrableDomain`
 * 不含端口，若一律走 `subLabel(subdomain, registrableDomain)`，
 * `localhost:3000` 与 `localhost:8080` 会被算成同一个标签 "localhost"，
 * 于是两个不同站点在「同站点吸收 / 漂移校正 / 归并」里被判为同一站点而错误合并。
 */
export function siteValueOf(site: SiteKey): string {
  return site.subdomain === '' ? site.value : subLabel(site.subdomain, site.registrableDomain);
}

export function siteLabelOf(site: SiteKey): string {
  return domainToUnicode(siteValueOf(site));
}

/**
 * 站点桶键（分桶 / 同站点比较的唯一口径）：value + 子域。
 *
 * 用 \u0000 分隔而非直接拼接：裸域 example.com（subdomain 空）与
 * m.example.co（value=example.co）的拼接键同为 "example.com"，
 * 两个不同站点会被混进同一分区。
 */
export function siteBucketId(site: SiteKey): string {
  return `${site.value}\u0000${site.subdomain}`;
}
