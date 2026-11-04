import { domainToUnicode } from '@/core/url/punycode';
import type { GroupMode } from '@/core/schema/models';

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
function subLabel(subdomain: string, registrableDomain: string): string {
  return subdomain ? `${subdomain}.${registrableDomain}` : registrableDomain;
}

/**
 * 站点键 → 展示标签（建组标题 / 同站点判定的唯一口径）。
 *
 * 子域为空（裸域 / 本地 / IP）沿用解析器原始 value **保留端口**：
 * `SiteResolver` 对 local/ip 给出的 `registrableDomain` 不含端口，
 * 一律走 `subLabel` 会让 localhost:3000 与 localhost:8080 变同一标签而错误合并。
 */
function siteValueOf(site: SiteKey): string {
  return site.subdomain === '' ? site.value : subLabel(site.subdomain, site.registrableDomain);
}

function siteLabelOf(site: SiteKey): string {
  return domainToUnicode(siteValueOf(site));
}

/**
 * 站点桶键（分桶 / 同站点比较的唯一口径）：value + 子域。
 * 用 \u0000 分隔：裸域 example.com（子域空）与 m.example.co（value=example.co）拼接键相同，会混进同一分区。
 */
function siteBucketId(site: SiteKey): string {
  return `${site.value}\u0000${site.subdomain}`;
}

/**
 * 站点身份策略：把「站点 → 分桶键 / 分区键 / 展示标签」收口成一份契约。
 *
 * 分桶、同站点归并、原生组漂移拆分、自动建组的锚点判定必须共用同一个策略实例，
 * 否则按根域名分组时，子域成员会被按「子域全名」判成漂移并批量 ungroup。
 *  - bucketId：分桶与同站点比较的唯一键；
 *  - sectionKey：site 分区的 siteKey（也是折叠态持久化键，保留 punycode 原形）；
 *  - label：分区标题 / 原生组标题 / 成员身份标签（Unicode 展示形态）。
 */
export interface SiteGroupingPolicy {
  bucketId(site: SiteKey): string;
  sectionKey(site: SiteKey): string;
  label(site: SiteKey): string;
}

/** 一子域一组（site 模式的既有口径）。 */
export const SUBDOMAIN_POLICY: SiteGroupingPolicy = {
  bucketId: siteBucketId,
  sectionKey: siteValueOf,
  label: siteLabelOf
};

/**
 * 同注册域折叠（rootDomain 模式）。
 * value 已是站点身份：普通域名为 eTLD+1、托管域为 user.github.io、本地/IP 为 hostname:port；
 * 用 value 而非 registrableDomain，才能保住端口并避免把 alice.github.io 与 bob.github.io 合并。
 */
export const ROOT_DOMAIN_POLICY: SiteGroupingPolicy = {
  bucketId: (site) => site.value,
  sectionKey: (site) => site.value,
  label: (site) => domainToUnicode(site.value)
};

/**
 * 各聚合模式的站点身份策略；Record 穷尽保证新增 GroupMode 时必须显式决定口径。
 * opener / language / none 不按站点聚合，返回 null。
 */
const POLICY_BY_MODE: Record<GroupMode, SiteGroupingPolicy | null> = {
  site: SUBDOMAIN_POLICY,
  rootDomain: ROOT_DOMAIN_POLICY,
  opener: null,
  language: null,
  none: null
};

export function siteGroupingPolicyFor(mode: GroupMode): SiteGroupingPolicy | null {
  return POLICY_BY_MODE[mode];
}
