/**
 * 主机名归一化：全应用统一口径（小写、去 `www.`、去尾点），使 `www.a.com` 与 `a.com`、`a.com.` 与 `a.com` 视为同一站点。
 * 各功能必须共用此口径，否则「同一站点」会在不同功能里判成两个（聚合漏判 / 固定重复留存）。
 */

export function normalizeHostname(rawHostname: string): string {
  return rawHostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

/** 裸 IPv6 字面量（`::1`）：判定交给 URL 解析而非手写正则，避免把 `::::` 这类非法串当合法地址补括号落盘。 */
function isBareIpv6(host: string): boolean {
  if ((host.match(/:/g)?.length ?? 0) < 2) return false;
  // 先做字符集筛查（含 `[` `]` `@` 等的一律不是裸地址），再交给解析做权威判定。
  if (!/^[0-9a-fA-F:.]+$/.test(host)) return false;
  try {
    return new URL(`http://[${host}]/`).hostname.startsWith('[');
  } catch {
    return false;
  }
}

/** 白名单 host 归一：常规归一 + IDN 转 punycode（浏览器 hostname 已是 punycode，中文原文永不命中）；只在此链转码，`normalizeHostname` 保持不编码不解码。 */
function normalizeHostPart(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  // 方括号只用于 IPv6 字面量：交给 URL 解析验证地址并输出浏览器同口径的规范形式。
  if (normalized.startsWith('[') || normalized.endsWith(']')) {
    try {
      const parsedHostname = new URL(`http://${normalized}/`).hostname;
      return parsedHostname.startsWith('[') ? parsedHostname : '';
    } catch {
      return '';
    }
  }
  // 含空白一律判空：`a b.com` 在 URL 解析处必然抛错、白名单永不命中，留着就是白占额度。
  // 只拦空白、不校验 DNS 标签合法性：`a..com` / `-a.com` / `a_b.com` 实测能原样回环，收紧只会误伤合法条目。
  if (/\s/.test(normalized)) return '';
  if (normalized === '' || /^[\x20-\x7E]+$/.test(normalized)) return normalized;
  try {
    return new URL(`http://${normalized}/`).hostname;
  } catch {
    // 转不动的（非法标签 / 超长）不落盘：留着就是一条永不命中的额度占用
    return '';
  }
}

/** 休眠白名单条目归一化（用户可粘贴整串 URL），额外处理 scheme / 路径 / query / fragment；必须落在 schema 层，因导入/同步/直写 storage 不经设置页，UI 侧归一会让尾斜杠条目永久失配。 */
export function normalizeWhitelistHost(rawEntry: string): string {
  const host = rawEntry
    .trim()
    // 剥离任意 scheme 且大小写不敏感：否则 `HTTPS://A.com` 匹配不上，去路径后会归一出 `https:` 这种垃圾条目。
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    // 路径、query、fragment 都不是主机身份；无斜杠的 `a.com?x=1` / `a.com#top` 同样要剥离。
    .replace(/[/?#].*$/, '');
  // 凭据串（`user@host`）不是 hostname，落盘即是一条永不命中又白占额度的条目。
  if (host.includes('@')) return '';
  // 裸 IPv6 先补方括号：URL 解析与 `SiteResolver` 产出的都是 `[::1]`，不补会把合法条目判空、白名单与站点归组口径不一致。
  const candidate = isBareIpv6(host) ? `[${host}]` : host;
  if (!candidate.includes(':')) return normalizeHostPart(candidate);
  // 含冒号时只有三种合法形态：`host:port`、`[IPv6]`、`[IPv6]:port`，其余判空。
  // `[IPv6]` 无端口形态必须放行：Chrome 默认端口的 IPv6 URL 正是 `http://[::1]/`，`SiteResolver` 也把 `[::1]` 当站点键，丢掉会让两处口径不一致。
  const match = /^([^:]+|\[[^\]]+\])(?::(\d+))?$/.exec(candidate);
  if (match === null) return '';
  // 端口须在 1–65535：`a.com:0`、`a.com:99999` 永不命中，同样白占额度。
  if (match[2] !== undefined) {
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '';
  }
  // host 部分先归一再拼端口：整串归一会让 `a.com.:080` 留下尾点与前导零，与 URL 解析出的 `a.com:80` 永不相等。
  const hostname = normalizeHostPart(match[1] ?? '');
  if (hostname === '') return '';
  return match[2] === undefined ? hostname : `${hostname}:${Number(match[2])}`;
}
