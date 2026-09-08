/**
 * 主机名归一化：全应用统一口径。
 *
 * 归一规则（三处旧实现逐字重复，此处提为唯一来源）：
 *  1. 小写（DNS 不区分大小写，比较键必须唯一）；
 *  2. 去 `www.` 前缀（www 不是身份，`www.a.com` 与 `a.com` 是同一站点）；
 *  3. 去尾点（`a.com.` 是合法 FQDN，与 `a.com` 同义）。
 *
 * 此前 `core/fixed/PinIdentity` 与 `core/site/SiteResolver` 各自内联一份，
 * `core/nocache/noCachePattern` 又用正则重写了一份 —— 三处只要有一处改动而
 * 其余没跟上，「同一站点」就会在不同功能里判成两个（聚合漏判 / 固定重复留存）。
 */

export function normalizeHostname(rawHostname: string): string {
  return rawHostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}
