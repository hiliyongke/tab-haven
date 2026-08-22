/**
 * 主机名归一化：全应用统一口径。
 *
 * 归一规则：
 *  1. 小写（DNS 不区分大小写，比较键必须唯一）；
 *  2. 去 `www.` 前缀（www 不是身份，`www.a.com` 与 `a.com` 是同一站点）；
 *  3. 去尾点（`a.com.` 是合法 FQDN，与 `a.com` 同义）。
 *
 * 各功能各写一份时，只要有一处改动而其余没跟上，「同一站点」就会在不同功能里
 * 判成两个（聚合漏判 / 固定重复留存）。
 */

export function normalizeHostname(rawHostname: string): string {
  return rawHostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

/**
 * 裸 IPv6：未带方括号的 IPv6 字面量（`::1`、`fe80::1`、`::ffff:192.0.2.1`）。
 *
 * 判定交给 URL 解析而不是自己写段数正则：段数、压缩 `::` 的位置、末尾点分
 * 十进制这些规则手写容易漏，漏了就会把 `::::`、`1:2:3` 这类永不命中的串
 * 当成合法地址补上括号落盘（白占一条额度，用户还以为生效了）。
 */
function isBareIpv6(host: string): boolean {
  if ((host.match(/:/g)?.length ?? 0) < 2) return false;
  // 先做字符集筛查（含 `[` `]` `@` 等的一律不是裸地址），再交给解析做权威判定。
  if (!/^[0-9a-fA-F:.]+$/.test(host)) return false;
  try {
    return new URL(`http://[${host}]/`).hostname === `[${host}]`;
  } catch {
    return false;
  }
}

/**
 * 白名单 host 部分的归一：常规归一 + IDN 转 punycode。
 *
 * 非 ASCII（`中文.cn`）必须转码：白名单要命中的是标签 URL 的 hostname，而浏览器
 * 给出的 hostname 已是 punycode，存中文原文的条目永不命中。
 * 只在**这一条**链上转码——`normalizeHostname` 保持「不解码也不编码」（解码是
 * domainToUnicode 的职责），避免改动站点聚合键等既有口径。
 */
function normalizeHostPart(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  if (normalized === '' || /^[\x20-\x7E]+$/.test(normalized)) return normalized;
  try {
    return new URL(`http://${normalized}/`).hostname;
  } catch {
    // 转不动的（非法标签 / 超长）不落盘：留着就是一条永不命中的额度占用
    return '';
  }
}

/**
 * 休眠白名单条目的归一化（用户可粘贴 `https://www.a.com/path` 这类整串）。
 *
 * 与 `normalizeHostname` 同一口径，额外处理「带 scheme / 带路径」的自由输入。
 * 归一化必须落在 schema 层（与 `noCachePatterns` 同口径）：备份导入、同步镜像、
 * 直接写 storage 三条路径都不经过设置页的输入处，落在 UI 侧会留下未归一化值，
 * 而匹配端再归一化一次时 `mail.qq.com/` 这类尾斜杠条目会永久失配。
 */
export function normalizeWhitelistHost(rawEntry: string): string {
  const host = rawEntry
    .trim()
    // 剥离任意 scheme（不止 http/https），且必须大小写不敏感：粘贴 `HTTPS://A.com`
    // 时大小写敏感的正则匹配不上，随后「去路径」又从第一个 `/` 切走，归一出
    // `https:` 这种永远匹配不上的垃圾条目。
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    // 去路径（`a.com/path` → `a.com`）。
    .replace(/\/.*$/, '');
  // 凭据串（`user@host`）不是 hostname，落盘即是一条永不命中又白占额度的条目。
  if (host.includes('@')) return '';
  // 裸 IPv6 先补方括号：手输的 `::1` 不是 `host:port` 形态，但地址本身合法，
  // 而 URL 解析与 `SiteResolver` 产出的都是 `[::1]` —— 不补就把合法条目判空，
  // 白名单与站点归组两处口径再次不一致。
  const candidate = isBareIpv6(host) ? `[${host}]` : host;
  if (!candidate.includes(':')) return normalizeHostPart(candidate);
  // 含冒号时只有三种合法形态：
  //   - `host:port`（本地开发站点常见）
  //   - `[IPv6]` —— 方括号内的冒号属于地址本身；**无端口形态必须放行**：Chrome
  //     默认端口的 IPv6 URL 正是 `http://[::1]/`，而 `SiteResolver` 同样把 `[::1]`
  //     作为站点键 —— 在此丢掉它，白名单与站点归组两处口径就不一致了。
  //   - `[IPv6]:port`
  // 其余一律判空丢弃（含 `ftp:`、`a.com:8080:9090` 这类剥不干净或多余冒号的值）。
  const match = /^([^:]+|\[[^\]]+\])(?::(\d+))?$/.exec(candidate);
  if (match === null) return '';
  // 端口须在 1–65535：`a.com:0`、`a.com:99999` 永不命中，同样白占额度。
  if (match[2] !== undefined) {
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '';
  }
  // host 部分先归一再拼端口：整串归一会让 `a.com.:080` 留下尾点与前导零
  // （`a.com.:80` / `a.com:080`），与 URL 解析出的 `a.com:80` 永不相等——
  // 表现为「白名单里明明写了，却一直不生效」。
  const hostname = normalizeHostPart(match[1] ?? '');
  if (hostname === '') return '';
  return match[2] === undefined ? hostname : `${hostname}:${Number(match[2])}`;
}
