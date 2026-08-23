import { getDomain } from 'tldts';
import { classifyHost } from '@/core/site/HostRules';
import type { SiteKey } from '@/core/site/SiteKey';

/**
 * 站点解析器：URL → 归组键。
 *
 * 解析管线（按序）：
 *  1. 规约：仅 http(s) 参与，hostname 小写、去 www 前缀、去尾点；
 *  2. 主机归类（HostRules）：本地/IP → 带端口整体为键；托管后缀 → 三级域；
 *  3. 其余：tldts 取注册域（PSL 权威，覆盖国家复合后缀等）；
 *  4. 内网回退：tldts 默认仅认 ICANN 公共后缀，.corp/.local/.internal 等
 *     非标准后缀解析失败时按「最后两段」近似注册域（单标签 host 整体为键），
 *     使内网多子域（通常一个子域一个业务）也能参与归组与子域亚组。
 */

export class SiteResolver {
  resolve(rawUrl: string): SiteKey | null {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

      const hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      if (!hostname) return null;

      const classification = classifyHost(hostname);

      if (classification.kind === 'local' || classification.kind === 'ip') {
        const value = url.port ? `${hostname}:${url.port}` : hostname;
        return { value, label: value, registrableDomain: hostname, subdomain: '' };
      }

      if (classification.kind === 'public' && classification.hostedSuffix) {
        const labels = hostname.split('.');
        const value = labels.slice(-3).join('.');
        return { value, label: value, registrableDomain: value, subdomain: '' };
      }

      const domain = getDomain(hostname);
      if (!domain) {
        // 内网回退：非标准后缀（.corp/.local/.internal 等）不在公共后缀表。
        const labels = hostname.split('.');
        if (labels.length >= 2) {
          const fallback = labels.slice(-2).join('.');
          const subdomain =
            hostname === fallback ? '' : hostname.slice(0, hostname.length - fallback.length - 1);
          return { value: fallback, label: fallback, registrableDomain: fallback, subdomain };
        }
        return { value: hostname, label: hostname, registrableDomain: hostname, subdomain: '' };
      }
      const subdomain =
        hostname === domain ? '' : hostname.slice(0, hostname.length - domain.length - 1);

      return { value: domain, label: domain, registrableDomain: domain, subdomain };
    } catch {
      return null;
    }
  }
}

export const siteResolver = new SiteResolver();
