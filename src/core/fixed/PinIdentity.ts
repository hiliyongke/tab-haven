/**
 * 永久固定图标身份：同一站点（主机名 + 端口）视为同一入口。
 *
 * hostname 小写、去 www 前缀、去尾点、保留端口；
 * 同站点不同路径共享同一身份（天然去重）。
 */

export function pinIdentity(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    if (!hostname) return null;
    return url.port ? `${hostname}:${url.port}` : hostname;
  } catch {
    return null;
  }
}
