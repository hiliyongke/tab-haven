import { normalizeHostname } from '@/core/url/hostname';
import { PINS_LIMIT } from '@/core/schema/models';

/**
 * 常驻磁贴身份：同一站点（主机名 + 端口）视为同一入口。
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

/**
 * 新增磁贴的数量预检（唯一口径）。所有写路径必须先过此函数：超限数据导出时不校验、
 * 导入时被 .max(PINS_LIMIT) 整批拒绝，用户只会看到「备份文件无效」。
 */
export function canAddPin(pinCount: number): boolean {
  return pinCount < PINS_LIMIT;
}
