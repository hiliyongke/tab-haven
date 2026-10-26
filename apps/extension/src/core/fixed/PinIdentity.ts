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
 * 能否再新增一枚磁贴（数量预检的唯一口径）。
 *
 * 上限常量取自 schema 层（`PINS_LIMIT`），不在调用方各抄一份字面量：上限只存在于
 * 「导出 schema + 本函数」两处时，写路径绕过预检就会产出超限数据 —— 该数据导出时
 * 不校验、导入时被 `.max(PINS_LIMIT)` **整批拒绝**，用户只看到「备份文件无效」。
 * 写路径（store 与右键菜单）一律先过本函数。
 */
export function canAddPin(pinCount: number): boolean {
  return pinCount < PINS_LIMIT;
}
