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

/**
 * 休眠白名单条目的归一化（用户可粘贴 `https://www.a.com/path` 这类整串）。
 *
 * 与 `normalizeHostname` 同一口径，额外处理「带 scheme / 带路径」的自由输入。
 * 此前这条链被逐字复制在两处（设置页输入处与 SW 消费端），备份导入、
 * 同步镜像、直接写 storage 三条路径都不经过任何一处 —— 落盘即为未归一化值，
 * 而匹配端再归一化一次时 `mail.qq.com/` 这类尾斜杠条目会永久失配。
 * 归一化必须落在 schema 层（与 `noCachePatterns` 同口径）。
 */
export function normalizeWhitelistHost(rawEntry: string): string {
  return normalizeHostname(
    rawEntry
      .trim()
      // scheme 判定必须大小写不敏感：粘贴 `HTTPS://A.com` 时，大小写敏感的正则
      // 匹配不上，随后「去路径」又从第一个 `/` 切走，最终归一出 `https:` 这种
      // 永远匹配不上的垃圾条目。
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
  );
}
