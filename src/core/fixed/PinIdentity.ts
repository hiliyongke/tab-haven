import { normalizeHostname } from '@/core/url/hostname';

/**
 * 永久固定图标身份：同一站点（主机名 + 端口）视为同一入口。
 *
 * 同站点不同路径共享同一身份（天然去重）；hostname 归一口径见 normalizeHostname。
 */

export function pinIdentity(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const hostname = normalizeHostname(url.hostname);
    if (!hostname) return null;
    return url.port ? `${hostname}:${url.port}` : hostname;
  } catch {
    return null;
  }
}
